import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationSession } from '../../../src/auth/google-auth.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';
import { openBrowser } from '../../../src/utils/open-browser.js';
import { AUTHENTICATED_STATUS, createTestDependencies } from '../../helpers/fakes.js';
import {
  connectTestClient,
  expectError,
  expectSuccess,
  type ToolCallOutcome,
} from '../../helpers/harness.js';

// Never launch a real browser from tests.
vi.mock('../../../src/utils/open-browser.js', () => ({ openBrowser: vi.fn(() => false) }));

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&code_challenge=abc&code_challenge_method=S256&state=xyz';
const TOKEN_LIKE = /ya29\.|1\/\/|GOCSPX-|access_token|refresh_token|client_secret|Bearer /;

function session(): AuthorizationSession {
  return {
    authUrl: AUTH_URL,
    redirectUri: 'http://127.0.0.1:53682/oauth2callback',
    expiresAt: '2030-01-01T00:05:00.000Z',
    completion: Promise.resolve(),
  };
}

describe('auth tools', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;
  const outcomes: ToolCallOutcome[] = [];

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const outcome = await h.callTool(name, args);
    outcomes.push(outcome);
    return outcome;
  };

  beforeEach(async () => {
    t = createTestDependencies();
    t.auth.startAuthorization.mockResolvedValue(session());
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
    // Whatever happened in the test, no response may ever contain a token-like string.
    for (const outcome of outcomes.splice(0)) {
      expect(outcome.text).not.toMatch(TOKEN_LIKE);
    }
  });

  it('get_auth_status returns the auth status', async () => {
    const data = expectSuccess(await call('get_auth_status'));
    expect(data).toEqual(AUTHENTICATED_STATUS);
    expect(t.auth.getStatus).toHaveBeenCalledTimes(1);
  });

  it('get_auth_status rejects unexpected arguments', async () => {
    const outcome = await call('get_auth_status', { verbose: true });
    expect(outcome.isError).toBe(true);
    expect(t.auth.getStatus).not.toHaveBeenCalled();
  });

  it('authenticate does nothing when already authenticated', async () => {
    const data = expectSuccess(await call('authenticate', { openBrowser: false }));
    expect(data).toMatchObject({ alreadyAuthenticated: true });
    expect(t.auth.startAuthorization).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('authenticate starts the sign-in when not authenticated', async () => {
    t.auth.getStatus.mockResolvedValue({ ...AUTHENTICATED_STATUS, authenticated: false });
    const data = expectSuccess(await call('authenticate', { openBrowser: false }));
    expect(data).toEqual({
      alreadyAuthenticated: false,
      authUrl: AUTH_URL,
      expiresAt: '2030-01-01T00:05:00.000Z',
      browserOpened: false,
      instructions: expect.stringContaining('get_auth_status') as unknown,
    });
    expect(t.auth.startAuthorization).toHaveBeenCalledTimes(1);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('authenticate with force starts a new sign-in even when authenticated', async () => {
    const data = expectSuccess(await call('authenticate', { force: true, openBrowser: false }));
    expect(data).toMatchObject({ alreadyAuthenticated: false, authUrl: AUTH_URL });
    expect(t.auth.startAuthorization).toHaveBeenCalledTimes(1);
  });

  it('authenticate opens the browser by default', async () => {
    vi.mocked(openBrowser).mockReturnValueOnce(true);
    const data = expectSuccess(await call('authenticate', { force: true }));
    expect(openBrowser).toHaveBeenCalledWith(AUTH_URL);
    expect(data).toMatchObject({ browserOpened: true });
  });

  it('authenticate reports configuration problems as errors', async () => {
    t.auth.getStatus.mockResolvedValue({
      ...AUTHENTICATED_STATUS,
      authenticated: false,
      credentialsConfigured: false,
    });
    t.auth.startAuthorization.mockRejectedValue(
      new AppError(ErrorCode.INVALID_CREDENTIALS, 'Google OAuth credentials are not configured.'),
    );
    const error = expectError(await call('authenticate', { openBrowser: false }));
    expect(error).toEqual({
      code: ErrorCode.INVALID_CREDENTIALS,
      message: 'Google OAuth credentials are not configured.',
      retryable: false,
    });
  });

  it('authenticate rejects arguments of the wrong type', async () => {
    const outcome = await call('authenticate', { force: 'yes' });
    expect(outcome.isError).toBe(true);
    expect(t.auth.startAuthorization).not.toHaveBeenCalled();
  });

  it('sign_out revokes access and reports the result', async () => {
    const data = expectSuccess(await call('sign_out'));
    expect(data).toEqual({ signedOut: true, revokedAtGoogle: true });
    expect(t.auth.signOut).toHaveBeenCalledTimes(1);

    t.auth.signOut.mockResolvedValueOnce({ revoked: false });
    expect(expectSuccess(await call('sign_out'))).toEqual({
      signedOut: true,
      revokedAtGoogle: false,
    });
  });

  it('never leaks tokens from underlying errors', async () => {
    t.auth.getStatus.mockResolvedValue({ ...AUTHENTICATED_STATUS, authenticated: false });
    t.auth.startAuthorization.mockRejectedValueOnce(
      new Error('refresh_token=1//0gSecretRefreshTokenValue123 access_token=ya29.secret'),
    );
    const internal = expectError(await call('authenticate', { openBrowser: false }));
    expect(internal.code).toBe(ErrorCode.INTERNAL_ERROR);

    t.auth.signOut.mockRejectedValueOnce({
      status: 400,
      response: {
        status: 400,
        data: { error: { message: 'Bad token ya29.a0SecretAccessToken GOCSPX-secret' } },
      },
    });
    const rejected = expectError(await call('sign_out'));
    expect(rejected.code).toBe(ErrorCode.INVALID_REQUEST);
    expect(rejected.message).toContain('[REDACTED]');

    t.auth.getStatus.mockRejectedValueOnce({
      response: { status: 400, data: { error: 'invalid_grant', error_description: '1//0gAbc' } },
    });
    expect(expectError(await call('get_auth_status')).code).toBe(ErrorCode.AUTH_EXPIRED);
  });

  it('invalidates the auth cache when an auth tool fails with AUTH_EXPIRED', async () => {
    t.auth.getStatus.mockRejectedValueOnce(new AppError(ErrorCode.AUTH_EXPIRED, 'expired'));
    expectError(await call('get_auth_status'));
    expect(t.auth.invalidate).toHaveBeenCalledTimes(1);
  });
});
