import type { OAuth2Client } from 'google-auth-library';
import { describe, expect, it, vi } from 'vitest';
import { GoogleAuthManager } from '../../../src/auth/google-auth.js';
import type { StoredTokens, TokenStore } from '../../../src/auth/token-manager.js';
import { DOCS_SCOPE, DRIVE_SCOPES, type GoogleOAuthConfig } from '../../../src/config/config.js';
import { ErrorCode } from '../../../src/utils/errors.js';

const CONFIGURED_CLIENT = 'client-b.apps.googleusercontent.com';

const config: GoogleOAuthConfig = {
  clientId: CONFIGURED_CLIENT,
  clientSecret: 'client-secret',
  redirectUri: 'http://127.0.0.1:53682/oauth2callback',
  driveScope: 'drive',
  scopes: [DOCS_SCOPE, DRIVE_SCOPES.drive],
};

function memoryStore(initial: StoredTokens | null): TokenStore {
  let value = initial;
  return {
    load: () => Promise.resolve(value),
    save: (tokens) => {
      value = tokens;
      return Promise.resolve();
    },
    clear: () => {
      value = null;
      return Promise.resolve();
    },
  };
}

function createManager(tokens: StoredTokens) {
  const client = {
    on: vi.fn(),
    setCredentials: vi.fn(),
    getAccessToken: vi.fn(() => Promise.resolve({ token: 'access' })),
  };
  const manager = new GoogleAuthManager(
    config,
    memoryStore(tokens),
    () => client as unknown as OAuth2Client,
  );
  return { manager, client };
}

function storedTokens(clientId?: string): StoredTokens {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expiry_date: Date.now() + 3_600_000,
    scope: `${DOCS_SCOPE} ${DRIVE_SCOPES.drive}`,
    ...(clientId ? { client_id: clientId } : {}),
  };
}

describe('OAuth client binding of stored tokens', () => {
  it('rejects tokens issued to a different OAuth client', async () => {
    const { manager, client } = createManager(storedTokens('client-a.apps.googleusercontent.com'));
    await expect(manager.getAuthorizedClient()).rejects.toMatchObject({
      code: ErrorCode.NOT_AUTHENTICATED,
    });
    expect(client.setCredentials).not.toHaveBeenCalled();
    expect((await manager.getStatus()).authenticated).toBe(false);
  });

  it('accepts tokens issued to the configured client', async () => {
    const { manager } = createManager(storedTokens(CONFIGURED_CLIENT));
    await expect(manager.getAuthorizedClient()).resolves.toBeDefined();
    expect((await manager.getStatus()).authenticated).toBe(true);
  });

  it('accepts tokens stored before the client was recorded', async () => {
    const { manager } = createManager(storedTokens());
    await expect(manager.getAuthorizedClient()).resolves.toBeDefined();
  });

  it('never passes the recorded client ID to the OAuth client as a credential', async () => {
    const { manager, client } = createManager(storedTokens(CONFIGURED_CLIENT));
    await manager.getAuthorizedClient();
    expect(client.setCredentials).toHaveBeenCalledTimes(1);
    expect(client.setCredentials.mock.calls[0]?.[0]).not.toHaveProperty('client_id');
  });
});
