import type { OAuth2Client } from 'google-auth-library';
import type { AppError } from '../utils/errors.js';
import type { AuthorizationSession, AuthService, AuthStatus } from './google-auth.js';

/**
 * Auth service used when the server configuration is invalid. The server still starts, so MCP
 * hosts such as Claude Desktop stay connected, and every Google operation reports the
 * configuration problem instead of the process exiting with no explanation.
 */
export class UnavailableAuthService implements AuthService {
  constructor(private readonly error: AppError) {}

  getAuthorizedClient(): Promise<OAuth2Client> {
    return Promise.reject(this.error);
  }

  startAuthorization(): Promise<AuthorizationSession> {
    return Promise.reject(this.error);
  }

  signOut(): Promise<{ revoked: boolean }> {
    return Promise.reject(this.error);
  }

  invalidate(): void {
    // Nothing is cached in unconfigured mode.
  }

  getStatus(): Promise<AuthStatus> {
    return Promise.resolve({
      authenticated: false,
      credentialsConfigured: false,
      requiredScopes: [],
      grantedScopes: [],
      missingScopes: [],
      hasRefreshToken: false,
      accessTokenExpiresAt: null,
      authorizationPending: false,
      configurationError: this.error.message,
    });
  }
}
