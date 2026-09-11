import net, { type AddressInfo } from 'node:net';
import type { Credentials, OAuth2Client, OAuth2ClientOptions } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findMissingScopes,
  GoogleAuthManager,
  type OAuth2ClientFactory,
} from '../../../src/auth/google-auth.js';
import type { StoredTokens, TokenStore } from '../../../src/auth/token-manager.js';
import {
  DEFAULT_REDIRECT_URI,
  DOCS_SCOPE,
  DRIVE_SCOPES,
  type GoogleOAuthConfig,
} from '../../../src/config/config.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&code_challenge=x';
const FULL_SCOPE = `${DOCS_SCOPE} ${DRIVE_SCOPES.drive}`;
const REFRESH_TOKEN = '1//refresh-token-value-abcdefghijklmnop';
const HOUR = 3_600_000;

function validTokens(overrides: StoredTokens = {}): StoredTokens {
  return {
    access_token: 'ya29.valid-access-token',
    refresh_token: REFRESH_TOKEN,
    expiry_date: Date.now() + HOUR,
    scope: FULL_SCOPE,
    token_type: 'Bearer',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GoogleOAuthConfig> = {}): GoogleOAuthConfig {
  return {
    clientId: 'test-client.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-test-secret',
    redirectUri: DEFAULT_REDIRECT_URI,
    driveScope: 'drive',
    scopes: [DOCS_SCOPE, DRIVE_SCOPES.drive],
    ...overrides,
  };
}

type TokensListener = (tokens: Credentials) => void;

function createFakeOAuthClient() {
  let tokensListener: TokensListener | undefined;
  return {
    setCredentials: vi.fn<(credentials: Credentials) => void>(),
    getAccessToken: vi.fn<() => Promise<{ token?: string | null }>>(() =>
      Promise.resolve({ token: 'ya29.valid-access-token' }),
    ),
    generateAuthUrl: vi.fn<(options: Record<string, unknown>) => string>(() => AUTH_URL),
    generateCodeVerifierAsync: vi.fn<
      () => Promise<{ codeVerifier: string; codeChallenge?: string }>
    >(() =>
      Promise.resolve({ codeVerifier: 'test-code-verifier', codeChallenge: 'test-challenge' }),
    ),
    getToken: vi.fn<(options: Record<string, unknown>) => Promise<{ tokens: Credentials }>>(() =>
      Promise.resolve({
        tokens: {
          access_token: 'ya29.new-access-token',
          refresh_token: '1//new-refresh-token-abcdefghijklmnop',
          expiry_date: Date.now() + HOUR,
          scope: FULL_SCOPE,
          token_type: 'Bearer',
        },
      }),
    ),
    revokeToken: vi.fn<(token: string) => Promise<unknown>>(() => Promise.resolve({})),
    on: vi.fn((event: string, listener: TokensListener) => {
      if (event === 'tokens') tokensListener = listener;
    }),
    /** Simulates google-auth-library emitting refreshed tokens. */
    emitTokens(tokens: Credentials): void {
      if (!tokensListener) throw new Error('No tokens listener registered');
      tokensListener(tokens);
    },
  };
}

type FakeOAuthClient = ReturnType<typeof createFakeOAuthClient>;

function createMemoryStore(initial: StoredTokens | null = null) {
  let current = initial;
  return {
    get current() {
      return current;
    },
    load: vi.fn<TokenStore['load']>(() => Promise.resolve(current)),
    save: vi.fn<TokenStore['save']>((tokens) => {
      current = tokens;
      return Promise.resolve();
    }),
    clear: vi.fn<TokenStore['clear']>(() => {
      current = null;
      return Promise.resolve();
    }),
  };
}

type MemoryStore = ReturnType<typeof createMemoryStore>;

function setup(
  options: { config?: Partial<GoogleOAuthConfig>; tokens?: StoredTokens | null } = {},
) {
  const fake = createFakeOAuthClient();
  const store = createMemoryStore(options.tokens === undefined ? null : options.tokens);
  const factory = vi.fn<OAuth2ClientFactory>(
    (_options: OAuth2ClientOptions) => fake as unknown as OAuth2Client,
  );
  const manager = new GoogleAuthManager(makeConfig(options.config), store, factory);
  return { fake, store, factory, manager };
}

async function captureAppError(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof AppError)) throw new Error(`Expected an AppError, got ${String(err)}`);
  return err;
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return port;
}

const invalidGrantError = () => ({
  message: 'invalid_grant',
  status: 400,
  response: {
    status: 400,
    data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
  },
});

describe('findMissingScopes', () => {
  it('returns required scopes that were not granted', () => {
    expect(findMissingScopes(DOCS_SCOPE, [DOCS_SCOPE, DRIVE_SCOPES.drive])).toEqual([
      DRIVE_SCOPES.drive,
    ]);
    expect(findMissingScopes(FULL_SCOPE, [DOCS_SCOPE, DRIVE_SCOPES.drive])).toEqual([]);
  });

  it('treats the full drive scope as covering drive.file', () => {
    expect(findMissingScopes(FULL_SCOPE, [DOCS_SCOPE, DRIVE_SCOPES['drive.file']])).toEqual([]);
    expect(
      findMissingScopes(`${DOCS_SCOPE} ${DRIVE_SCOPES['drive.file']}`, [
        DOCS_SCOPE,
        DRIVE_SCOPES.drive,
      ]),
    ).toEqual([DRIVE_SCOPES.drive]);
  });

  it('cannot judge tokens without a scope string', () => {
    expect(findMissingScopes(undefined, [DOCS_SCOPE])).toEqual([]);
    expect(findMissingScopes(null, [DOCS_SCOPE])).toEqual([]);
  });
});

describe('GoogleAuthManager.getAuthorizedClient', () => {
  it('fails with INVALID_CREDENTIALS when client credentials are missing', async () => {
    for (const config of [
      { clientId: undefined },
      { clientSecret: undefined },
      { clientId: undefined, clientSecret: undefined },
    ]) {
      const { manager, factory } = setup({ config, tokens: validTokens() });
      const error = await captureAppError(manager.getAuthorizedClient());
      expect(error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      expect(error.message).toContain('GOOGLE_CLIENT_ID');
      expect(factory).not.toHaveBeenCalled();
    }
  });

  it('fails with NOT_AUTHENTICATED when no tokens are stored', async () => {
    const { manager } = setup({ tokens: null });
    const error = await captureAppError(manager.getAuthorizedClient());
    expect(error.code).toBe(ErrorCode.NOT_AUTHENTICATED);
    expect(error.message).toContain('authenticate');
  });

  it('fails with NOT_AUTHENTICATED when stored tokens hold neither access nor refresh token', async () => {
    const { manager } = setup({ tokens: { scope: FULL_SCOPE } });
    expect((await captureAppError(manager.getAuthorizedClient())).code).toBe(
      ErrorCode.NOT_AUTHENTICATED,
    );
  });

  it('returns the client and applies stored credentials only once', async () => {
    const tokens = validTokens();
    const { manager, fake, store, factory } = setup({ tokens });

    const first = await manager.getAuthorizedClient();
    const second = await manager.getAuthorizedClient();

    expect(first).toBe(fake);
    expect(second).toBe(fake);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-test-secret',
      redirectUri: DEFAULT_REDIRECT_URI,
    });
    expect(fake.setCredentials).toHaveBeenCalledTimes(1);
    expect(fake.setCredentials).toHaveBeenCalledWith(tokens);
    expect(fake.getAccessToken).toHaveBeenCalledTimes(2);
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired access token and persists the result, keeping the refresh token', async () => {
    const { manager, fake, store } = setup({
      tokens: validTokens({ access_token: 'ya29.expired', expiry_date: Date.now() - 1000 }),
    });
    const refreshedExpiry = Date.now() + HOUR;
    fake.getAccessToken.mockImplementation(() => {
      // google-auth-library emits 'tokens' on refresh; Google omits the refresh token.
      fake.emitTokens({
        access_token: 'ya29.refreshed',
        expiry_date: refreshedExpiry,
        token_type: 'Bearer',
        scope: FULL_SCOPE,
      });
      return Promise.resolve({ token: 'ya29.refreshed' });
    });

    await expect(manager.getAuthorizedClient()).resolves.toBe(fake);

    expect(fake.getAccessToken).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(store.save).toHaveBeenCalledTimes(1);
    });
    expect(store.current).toEqual({
      access_token: 'ya29.refreshed',
      refresh_token: REFRESH_TOKEN,
      expiry_date: refreshedExpiry,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });

    // The refreshed tokens are already applied inside the client; no redundant setCredentials.
    await manager.getAuthorizedClient();
    expect(fake.setCredentials).toHaveBeenCalledTimes(1);
  });

  it('keeps the refresh token when a refresh is persisted after the cache was invalidated', async () => {
    const { manager, fake, store } = setup({ tokens: validTokens() });
    await manager.getAuthorizedClient();
    manager.invalidate();

    fake.emitTokens({ access_token: 'ya29.background-refresh', expiry_date: Date.now() + HOUR });

    await vi.waitFor(() => {
      expect(store.save).toHaveBeenCalledTimes(1);
    });
    expect(store.current).toMatchObject({
      access_token: 'ya29.background-refresh',
      refresh_token: REFRESH_TOKEN,
      scope: FULL_SCOPE,
    });
  });

  it('fails with AUTH_EXPIRED when the access token expired and there is no refresh token', async () => {
    const { manager, fake } = setup({
      tokens: validTokens({ refresh_token: undefined, expiry_date: Date.now() - 1000 }),
    });
    const error = await captureAppError(manager.getAuthorizedClient());
    expect(error.code).toBe(ErrorCode.AUTH_EXPIRED);
    expect(error.message).toContain('authenticate');
    expect(fake.getAccessToken).not.toHaveBeenCalled();
  });

  it('accepts a still-valid access token without a refresh token', async () => {
    const { manager } = setup({ tokens: validTokens({ refresh_token: undefined }) });
    await expect(manager.getAuthorizedClient()).resolves.toBeDefined();
  });

  it('maps a refresh failure with invalid_grant to AUTH_EXPIRED and drops the cache', async () => {
    const { manager, fake, store } = setup({
      tokens: validTokens({ expiry_date: Date.now() - 1000 }),
    });
    fake.getAccessToken.mockRejectedValueOnce(invalidGrantError());

    const error = await captureAppError(manager.getAuthorizedClient());
    expect(error.code).toBe(ErrorCode.AUTH_EXPIRED);
    expect(error.message).not.toContain(REFRESH_TOKEN);
    expect(store.load).toHaveBeenCalledTimes(1);

    // The next call re-reads the token store (e.g. after `google-docs-mcp auth` in a terminal).
    await manager.getAuthorizedClient();
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(fake.setCredentials).toHaveBeenCalledTimes(2);
  });

  it('does not drop the cache for transient refresh failures', async () => {
    const { manager, fake, store } = setup({ tokens: validTokens() });
    fake.getAccessToken.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'), {
        code: 'ENOTFOUND',
      }),
    );
    const error = await captureAppError(manager.getAuthorizedClient());
    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    await manager.getAuthorizedClient();
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('fails with NOT_AUTHENTICATED and lists missing scopes', async () => {
    const { manager, fake } = setup({ tokens: validTokens({ scope: DOCS_SCOPE }) });
    const error = await captureAppError(manager.getAuthorizedClient());
    expect(error.code).toBe(ErrorCode.NOT_AUTHENTICATED);
    expect(error.details).toEqual({ missingScopes: [DRIVE_SCOPES.drive] });
    expect(fake.setCredentials).not.toHaveBeenCalled();
  });

  it('accepts a full drive grant when only drive.file is required', async () => {
    const { manager } = setup({
      config: { driveScope: 'drive.file', scopes: [DOCS_SCOPE, DRIVE_SCOPES['drive.file']] },
      tokens: validTokens({ scope: FULL_SCOPE }),
    });
    await expect(manager.getAuthorizedClient()).resolves.toBeDefined();
  });

  it('rejects a drive.file grant when the full drive scope is required', async () => {
    const { manager } = setup({
      tokens: validTokens({ scope: `${DOCS_SCOPE} ${DRIVE_SCOPES['drive.file']}` }),
    });
    const error = await captureAppError(manager.getAuthorizedClient());
    expect(error.details).toEqual({ missingScopes: [DRIVE_SCOPES.drive] });
  });
});

describe('GoogleAuthManager.getStatus', () => {
  it('reports an authenticated session without exposing tokens', async () => {
    const expiry = Date.UTC(2030, 0, 1);
    const { manager } = setup({ tokens: validTokens({ expiry_date: expiry }) });
    const status = await manager.getStatus();
    expect(status).toEqual({
      authenticated: true,
      credentialsConfigured: true,
      requiredScopes: [DOCS_SCOPE, DRIVE_SCOPES.drive],
      grantedScopes: [DOCS_SCOPE, DRIVE_SCOPES.drive],
      missingScopes: [],
      hasRefreshToken: true,
      accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
      authorizationPending: false,
    });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('ya29');
    expect(serialized).not.toContain(REFRESH_TOKEN);
  });

  it('reports no session when nothing is stored', async () => {
    const { manager } = setup({ tokens: null });
    expect(await manager.getStatus()).toMatchObject({
      authenticated: false,
      credentialsConfigured: true,
      grantedScopes: [],
      missingScopes: [],
      hasRefreshToken: false,
      accessTokenExpiresAt: null,
    });
  });

  it('is not authenticated without client credentials', async () => {
    const { manager } = setup({ config: { clientSecret: undefined }, tokens: validTokens() });
    expect(await manager.getStatus()).toMatchObject({
      authenticated: false,
      credentialsConfigured: false,
    });
  });

  it('is not authenticated when scopes are missing or the token expired without refresh', async () => {
    const missing = setup({ tokens: validTokens({ scope: DOCS_SCOPE }) });
    expect(await missing.manager.getStatus()).toMatchObject({
      authenticated: false,
      missingScopes: [DRIVE_SCOPES.drive],
    });
    const expired = setup({
      tokens: validTokens({ refresh_token: undefined, expiry_date: Date.now() - 1000 }),
    });
    expect(await expired.manager.getStatus()).toMatchObject({
      authenticated: false,
      hasRefreshToken: false,
    });
  });

  it('re-reads the token store on every call', async () => {
    const { manager, store } = setup({ tokens: null });
    expect((await manager.getStatus()).authenticated).toBe(false);
    await store.save(validTokens());
    expect((await manager.getStatus()).authenticated).toBe(true);
  });
});

describe('GoogleAuthManager.signOut', () => {
  it('revokes the refresh token and clears stored tokens', async () => {
    const { manager, fake, store } = setup({ tokens: validTokens() });
    await manager.getAuthorizedClient();

    await expect(manager.signOut()).resolves.toEqual({ revoked: true });

    expect(fake.revokeToken).toHaveBeenCalledWith(REFRESH_TOKEN);
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(store.current).toBeNull();
    expect(fake.setCredentials).toHaveBeenLastCalledWith({});
    expect((await captureAppError(manager.getAuthorizedClient())).code).toBe(
      ErrorCode.NOT_AUTHENTICATED,
    );
  });

  it('revokes the access token when there is no refresh token', async () => {
    const { manager, fake } = setup({ tokens: validTokens({ refresh_token: undefined }) });
    await manager.signOut();
    expect(fake.revokeToken).toHaveBeenCalledWith('ya29.valid-access-token');
  });

  it('still deletes local tokens when revocation fails', async () => {
    const { manager, fake, store } = setup({ tokens: validTokens() });
    fake.revokeToken.mockRejectedValueOnce({ status: 400, response: { status: 400 } });
    await expect(manager.signOut()).resolves.toEqual({ revoked: false });
    expect(store.current).toBeNull();
  });

  it('clears tokens without contacting Google when credentials are not configured', async () => {
    const { manager, fake, store, factory } = setup({
      config: { clientId: undefined },
      tokens: validTokens(),
    });
    await expect(manager.signOut()).resolves.toEqual({ revoked: false });
    expect(fake.revokeToken).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalled();
  });

  it('does not revoke anything when no tokens are stored', async () => {
    const { manager, fake } = setup({ tokens: null });
    await expect(manager.signOut()).resolves.toEqual({ revoked: false });
    expect(fake.revokeToken).not.toHaveBeenCalled();
  });
});

describe('GoogleAuthManager loopback authorization flow', () => {
  let port: number;
  let redirectUri: string;
  let ctx: { fake: FakeOAuthClient; store: MemoryStore; manager: GoogleAuthManager };

  const callbackUrl = (params: Record<string, string>, pathname = '/oauth2callback') =>
    `http://127.0.0.1:${port}${pathname}?${new URLSearchParams(params).toString()}`;

  const stateFrom = (fake: FakeOAuthClient): string => {
    const options = fake.generateAuthUrl.mock.calls[0]?.[0];
    const state = options?.state;
    if (typeof state !== 'string') throw new Error('generateAuthUrl was not called with a state');
    return state;
  };

  beforeEach(async () => {
    port = await getFreePort();
    redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    ctx = setup({ config: { redirectUri }, tokens: null });
  });

  afterEach(async () => {
    // Closes the callback server if a test left the flow pending.
    await ctx.manager.signOut();
  });

  it('completes the authorization-code flow with PKCE and state', async () => {
    const { manager, fake, store } = ctx;
    const session = await manager.startAuthorization();

    expect(session.authUrl).toBe(AUTH_URL);
    expect(session.redirectUri).toBe(redirectUri);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
    expect(fake.generateAuthUrl).toHaveBeenCalledTimes(1);
    expect(fake.generateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DOCS_SCOPE, DRIVE_SCOPES.drive],
      state: expect.any(String) as unknown,
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
    });
    const state = stateFrom(fake);
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect((await manager.getStatus()).authorizationPending).toBe(true);

    // A second call reuses the pending flow.
    expect((await manager.startAuthorization()).authUrl).toBe(AUTH_URL);
    expect(fake.generateAuthUrl).toHaveBeenCalledTimes(1);

    // Unknown paths are ignored.
    expect((await fetch(callbackUrl({ state, code: 'x' }, '/other'))).status).toBe(404);

    // A forged callback with the wrong state is rejected and the flow keeps waiting.
    const forged = await fetch(callbackUrl({ state: 'forged-state', code: 'attacker-code' }));
    expect(forged.status).toBe(400);
    expect(await forged.text()).toContain('Invalid or missing state');
    expect((await fetch(callbackUrl({ code: 'no-state' }))).status).toBe(400);
    expect(fake.getToken).not.toHaveBeenCalled();
    expect((await manager.getStatus()).authorizationPending).toBe(true);

    // The correct state but no code is also rejected without ending the flow.
    expect((await fetch(callbackUrl({ state }))).status).toBe(400);
    expect((await manager.getStatus()).authorizationPending).toBe(true);

    // The real redirect from Google.
    const response = await fetch(callbackUrl({ state, code: '4/0AuthCode', scope: FULL_SCOPE }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain('now authorized');
    expect(body).not.toContain('4/0AuthCode');

    await expect(session.completion).resolves.toBeUndefined();
    expect(fake.getToken).toHaveBeenCalledWith({
      code: '4/0AuthCode',
      codeVerifier: 'test-code-verifier',
      redirect_uri: redirectUri,
    });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.current).toMatchObject({
      access_token: 'ya29.new-access-token',
      refresh_token: '1//new-refresh-token-abcdefghijklmnop',
      scope: FULL_SCOPE,
    });

    // The callback server is closed once the flow finishes.
    expect((await manager.getStatus()).authorizationPending).toBe(false);
    await expect(fetch(callbackUrl({ state, code: 'again' }))).rejects.toThrow();

    // The new tokens are used for API calls.
    await expect(manager.getAuthorizedClient()).resolves.toBe(fake);
    expect(fake.setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'ya29.new-access-token' }),
    );
  });

  it('rejects the completion with NOT_AUTHENTICATED when the user denies access', async () => {
    const { manager, fake, store } = ctx;
    const session = await manager.startAuthorization();
    const response = await fetch(callbackUrl({ state: stateFrom(fake), error: 'access_denied' }));
    expect(response.status).toBe(400);
    const error = await captureAppError(session.completion);
    expect(error.code).toBe(ErrorCode.NOT_AUTHENTICATED);
    expect(error.message).toContain('access_denied');
    expect(fake.getToken).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect((await manager.getStatus()).authorizationPending).toBe(false);
  });

  it('rejects the completion when the token exchange fails', async () => {
    const { manager, fake, store } = ctx;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fake.getToken.mockRejectedValueOnce(invalidGrantError());
    const session = await manager.startAuthorization();
    const response = await fetch(callbackUrl({ state: stateFrom(fake), code: '4/0Bad' }));
    expect(response.status).toBe(500);
    expect((await captureAppError(session.completion)).code).toBe(ErrorCode.AUTH_EXPIRED);
    expect(store.save).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('fails with CONFIG_ERROR when the callback port is already in use', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));
    try {
      const error = await captureAppError(ctx.manager.startAuthorization());
      expect(error.code).toBe(ErrorCode.CONFIG_ERROR);
      expect(error.message).toContain(String(port));
      expect((await ctx.manager.getStatus()).authorizationPending).toBe(false);
    } finally {
      await new Promise<void>((resolve) =>
        blocker.close(() => {
          resolve();
        }),
      );
    }
  });

  it('fails with INVALID_CREDENTIALS before listening when credentials are missing', async () => {
    const { manager } = setup({ config: { redirectUri, clientId: undefined } });
    expect((await captureAppError(manager.startAuthorization())).code).toBe(
      ErrorCode.INVALID_CREDENTIALS,
    );
    await expect(fetch(callbackUrl({ state: 'x' }))).rejects.toThrow();
  });

  it('sign-out cancels a pending flow and closes the callback server', async () => {
    await ctx.manager.startAuthorization();
    await ctx.manager.signOut();
    expect((await ctx.manager.getStatus()).authorizationPending).toBe(false);
    await expect(fetch(callbackUrl({ state: 'x' }))).rejects.toThrow();
  });
});
