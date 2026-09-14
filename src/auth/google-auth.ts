import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CodeChallengeMethod, OAuth2Client, type OAuth2ClientOptions } from 'google-auth-library';
import { DRIVE_SCOPES, type GoogleOAuthConfig, validateRedirectUri } from '../config/config.js';
import { AppError, ErrorCode, REAUTH_HINT, toAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  isAccessTokenExpired,
  mergeTokens,
  type StoredTokens,
  type TokenStore,
  toStoredTokens,
} from './token-manager.js';

/** Anything that can hand out an OAuth2 client with valid credentials for Google API calls. */
export interface AuthorizedClientProvider {
  getAuthorizedClient(): Promise<OAuth2Client>;
}

export interface AuthStatus {
  authenticated: boolean;
  credentialsConfigured: boolean;
  requiredScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
  hasRefreshToken: boolean;
  accessTokenExpiresAt: string | null;
  authorizationPending: boolean;
  /** Set when the server started with an invalid configuration; explains what to fix. */
  configurationError?: string;
}

export interface AuthorizationSession {
  authUrl: string;
  redirectUri: string;
  expiresAt: string;
  /** Resolves once the browser redirect has been received and tokens were stored. */
  completion: Promise<void>;
}

/** The subset of the auth manager used by MCP tools (kept small so it is easy to fake in tests). */
export interface AuthService extends AuthorizedClientProvider {
  getStatus(): Promise<AuthStatus>;
  startAuthorization(): Promise<AuthorizationSession>;
  signOut(): Promise<{ revoked: boolean }>;
  invalidate(): void;
}

export type OAuth2ClientFactory = (options: OAuth2ClientOptions) => OAuth2Client;

const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

/** Returns the required scopes that the granted scope string does not cover. */
export function findMissingScopes(
  granted: string | null | undefined,
  required: readonly string[],
): string[] {
  if (!granted) return [];
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  return required.filter(
    (scope) =>
      !grantedSet.has(scope) &&
      !(scope === DRIVE_SCOPES['drive.file'] && grantedSet.has(DRIVE_SCOPES.drive)),
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendPage(res: ServerResponse, status: number, message: string): void {
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
  });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Google Docs MCP</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>Google Docs MCP</h1><p>${safe}</p></body></html>`,
  );
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new AppError(
              ErrorCode.CONFIG_ERROR,
              `The OAuth callback port ${port} is already in use. Close the other process or change the port in GOOGLE_REDIRECT_URI.`,
            )
          : new AppError(
              ErrorCode.CONFIG_ERROR,
              'Unable to start the local OAuth callback server.',
              {
                cause: err,
              },
            ),
      );
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

interface PendingAuthorization extends AuthorizationSession {
  server: Server;
  timer: NodeJS.Timeout;
}

/**
 * Manages Google OAuth 2.0 for a single local user: the loopback authorization-code flow with
 * PKCE, secure token persistence, automatic access-token refresh and re-authentication.
 */
export class GoogleAuthManager implements AuthService {
  private client: OAuth2Client | undefined;
  /** `undefined` = not loaded yet; `null` = no tokens stored. */
  private tokens: StoredTokens | null | undefined;
  private appliedTokens: StoredTokens | undefined;
  private pending: PendingAuthorization | undefined;

  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly store: TokenStore,
    private readonly createClient: OAuth2ClientFactory = (options) => new OAuth2Client(options),
  ) {}

  private get credentialsConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  private getClient(): OAuth2Client {
    if (this.client) return this.client;
    const { clientId, clientSecret, redirectUri } = this.config;
    if (!clientId || !clientSecret) {
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        'Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment (see the README section "Google OAuth Setup").',
      );
    }
    const client = this.createClient({ clientId, clientSecret, redirectUri });
    // Fired whenever google-auth-library obtains new tokens (including automatic refreshes).
    client.on('tokens', (update) => {
      void this.persist(toStoredTokens(update));
    });
    this.client = client;
    return client;
  }

  private async persist(update: StoredTokens): Promise<void> {
    // The cache may have been invalidated since the tokens were loaded. Merge with the stored
    // tokens then, because refresh responses omit the refresh token and it must never be lost.
    const existing = this.tokens ?? (await this.store.load().catch(() => null));
    const merged = mergeTokens(existing, update);
    this.tokens = merged;
    this.appliedTokens = merged;
    try {
      await this.store.save(merged);
    } catch (err) {
      logger.error('Failed to persist OAuth tokens.', { error: err });
    }
  }

  private async loadTokens(): Promise<StoredTokens | null> {
    if (this.tokens === undefined) this.tokens = await this.store.load();
    return this.tokens;
  }

  /**
   * Tokens are bound to the OAuth client that issued them. Tokens recorded for another client
   * (for example after changing the client ID in the extension settings) cannot be used.
   * Tokens stored before the client was recorded are accepted.
   */
  private belongsToAnotherClient(tokens: StoredTokens | null | undefined): boolean {
    return Boolean(
      tokens?.client_id && this.config.clientId && tokens.client_id !== this.config.clientId,
    );
  }

  /** Drops cached credentials so the next call re-reads the token store. */
  invalidate(): void {
    this.tokens = undefined;
    this.appliedTokens = undefined;
  }

  async getAuthorizedClient(): Promise<OAuth2Client> {
    const client = this.getClient();
    const tokens = await this.loadTokens();
    if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
      throw new AppError(ErrorCode.NOT_AUTHENTICATED, `Not signed in to Google. ${REAUTH_HINT}`);
    }
    if (this.belongsToAnotherClient(tokens)) {
      throw new AppError(
        ErrorCode.NOT_AUTHENTICATED,
        `The stored Google authorization belongs to a different OAuth client than the one now configured. ${REAUTH_HINT}`,
      );
    }
    const missingScopes = findMissingScopes(tokens.scope, this.config.scopes);
    if (missingScopes.length > 0) {
      throw new AppError(
        ErrorCode.NOT_AUTHENTICATED,
        `The stored Google authorization does not include all required permissions. ${REAUTH_HINT}`,
        { details: { missingScopes } },
      );
    }
    if (!tokens.refresh_token && isAccessTokenExpired(tokens)) {
      throw new AppError(
        ErrorCode.AUTH_EXPIRED,
        `The Google access token has expired and no refresh token is available. ${REAUTH_HINT}`,
      );
    }
    if (this.appliedTokens !== tokens) {
      const { scope, client_id: _clientId, ...credentials } = tokens;
      client.setCredentials({ ...credentials, ...(scope ? { scope } : {}) });
      this.appliedTokens = tokens;
    }
    try {
      // Returns the cached token when valid; refreshes it (and emits 'tokens') when expired.
      await client.getAccessToken();
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === ErrorCode.AUTH_EXPIRED) this.invalidate();
      throw appError;
    }
    return client;
  }

  async getStatus(): Promise<AuthStatus> {
    this.invalidate();
    const tokens = await this.loadTokens();
    const grantedScopes = tokens?.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [];
    const missingScopes = tokens ? findMissingScopes(tokens.scope, this.config.scopes) : [];
    const hasRefreshToken = Boolean(tokens?.refresh_token);
    const usable = Boolean(tokens && (hasRefreshToken || !isAccessTokenExpired(tokens)));
    return {
      authenticated:
        this.credentialsConfigured &&
        usable &&
        missingScopes.length === 0 &&
        !this.belongsToAnotherClient(tokens),
      credentialsConfigured: this.credentialsConfigured,
      requiredScopes: [...this.config.scopes],
      grantedScopes,
      missingScopes,
      hasRefreshToken,
      accessTokenExpiresAt:
        tokens?.expiry_date != null ? new Date(tokens.expiry_date).toISOString() : null,
      authorizationPending: this.pending !== undefined,
    };
  }

  /**
   * Starts the OAuth 2.0 authorization-code flow (with PKCE and a CSRF `state`) and a temporary
   * loopback HTTP server that receives Google's redirect. Returns the URL the user must open.
   */
  async startAuthorization(): Promise<AuthorizationSession> {
    if (this.pending) return this.toSession(this.pending);

    const client = this.getClient();
    const redirect = validateRedirectUri(this.config.redirectUri);
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    if (!codeChallenge) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Failed to generate a PKCE code challenge.');
    }
    const state = randomBytes(32).toString('base64url');
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...this.config.scopes],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      redirect_uri: this.config.redirectUri,
    });

    let resolveCompletion: () => void = () => undefined;
    let rejectCompletion: (err: Error) => void = () => undefined;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // In MCP mode nobody awaits completion; avoid unhandled-rejection noise.
    completion.catch(() => undefined);

    const finish = (err?: Error) => {
      const pending = this.pending;
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.server.close();
      pending.server.closeAllConnections();
      this.pending = undefined;
      if (err) rejectCompletion(err);
      else resolveCompletion();
    };

    const server = createServer((req, res) => {
      void this.handleCallback(req, res, { redirect, state, codeVerifier, finish });
    });
    const host = redirect.hostname.replace(/^\[(.*)\]$/, '$1');
    await listen(server, Number(redirect.port), host);

    const timer = setTimeout(() => {
      finish(
        new AppError(
          ErrorCode.NOT_AUTHENTICATED,
          `Google sign-in was not completed within 5 minutes. ${REAUTH_HINT}`,
        ),
      );
    }, AUTHORIZATION_TIMEOUT_MS);
    timer.unref();

    this.pending = {
      authUrl,
      redirectUri: this.config.redirectUri,
      expiresAt: new Date(Date.now() + AUTHORIZATION_TIMEOUT_MS).toISOString(),
      completion,
      server,
      timer,
    };
    logger.info('Started Google OAuth authorization; waiting for the browser redirect.');
    return this.toSession(this.pending);
  }

  private toSession(pending: PendingAuthorization): AuthorizationSession {
    const { authUrl, redirectUri, expiresAt, completion } = pending;
    return { authUrl, redirectUri, expiresAt, completion };
  }

  private async handleCallback(
    req: IncomingMessage,
    res: ServerResponse,
    flow: { redirect: URL; state: string; codeVerifier: string; finish: (err?: Error) => void },
  ): Promise<void> {
    const url = new URL(req.url ?? '/', flow.redirect.origin);
    if (req.method !== 'GET' || url.pathname !== flow.redirect.pathname) {
      res.writeHead(404).end();
      return;
    }
    const returnedState = url.searchParams.get('state');
    if (!returnedState || !safeEqual(returnedState, flow.state)) {
      // Possibly a forged request (CSRF). Ignore it and keep waiting for the real redirect.
      sendPage(res, 400, 'Invalid or missing state parameter. Please restart the sign-in.');
      return;
    }
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      const reason = /^[a-z_]{1,64}$/.test(oauthError) ? oauthError : 'unknown_error';
      sendPage(res, 400, 'Google sign-in was cancelled or failed. You can close this window.');
      flow.finish(
        new AppError(
          ErrorCode.NOT_AUTHENTICATED,
          `Google sign-in failed (${reason}). ${REAUTH_HINT}`,
        ),
      );
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      sendPage(res, 400, 'The authorization code is missing. Please restart the sign-in.');
      return;
    }
    try {
      const { tokens } = await this.getClient().getToken({
        code,
        codeVerifier: flow.codeVerifier,
        redirect_uri: this.config.redirectUri,
      });
      const existing = await this.store.load();
      // Nothing from another OAuth client's tokens (such as its refresh token) may be carried over.
      const merged = mergeTokens(this.belongsToAnotherClient(existing) ? null : existing, {
        ...toStoredTokens(tokens),
        client_id: this.config.clientId ?? null,
      });
      await this.store.save(merged);
      this.tokens = merged;
      this.appliedTokens = undefined;
      sendPage(
        res,
        200,
        'Google Docs MCP is now authorized. You can close this window and return to your AI client.',
      );
      logger.info('Google authorization completed and tokens were stored.');
      flow.finish();
    } catch (err) {
      const appError = toAppError(err);
      logger.error('OAuth token exchange failed.', { code: appError.code, error: err });
      sendPage(
        res,
        500,
        'Token exchange with Google failed. Return to your AI client for details.',
      );
      flow.finish(appError);
    }
  }

  /** Revokes the grant at Google (best effort) and deletes the locally stored tokens. */
  async signOut(): Promise<{ revoked: boolean }> {
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      clearTimeout(pending.timer);
      pending.server.close();
    }
    const tokens = await this.store.load();
    const token = tokens?.refresh_token ?? tokens?.access_token;
    let revoked = false;
    if (token && this.credentialsConfigured) {
      try {
        await this.getClient().revokeToken(token);
        revoked = true;
      } catch (err) {
        logger.warn('Token revocation at Google failed; local tokens will still be removed.', {
          code: toAppError(err).code,
        });
      }
    }
    await this.store.clear();
    this.client?.setCredentials({});
    this.invalidate();
    return { revoked };
  }
}
