import { z } from 'zod';
import type { AuthService } from '../../auth/google-auth.js';
import { openBrowser } from '../../utils/open-browser.js';
import type { RegisterTool } from '../define-tool.js';

export function registerAuthTools(register: RegisterTool, auth: AuthService): void {
  register({
    name: 'get_auth_status',
    title: 'Get Google sign-in status',
    description:
      'Check whether this server is signed in to Google and holds the permissions required for Google Docs and Google Drive. Use it when another tool fails with NOT_AUTHENTICATED or AUTH_EXPIRED, or after the user finishes signing in via `authenticate`. Never returns tokens.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async () => auth.getStatus(),
  });

  register({
    name: 'authenticate',
    title: 'Sign in with Google',
    description:
      'Start the Google OAuth sign-in. Returns an `authUrl` that the user must open in a browser on the computer running this server to approve access to Google Docs and Drive; the server receives the result automatically on a local loopback address. Show the URL to the user, wait for them to confirm they approved access, then call `get_auth_status`. If already signed in, nothing happens unless `force` is true.',
    inputSchema: z.strictObject({
      force: z
        .boolean()
        .default(false)
        .describe('Start a new sign-in even if valid credentials already exist.'),
      openBrowser: z
        .boolean()
        .default(true)
        .describe('Also try to open the sign-in URL in the default browser automatically.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async ({ force, openBrowser: shouldOpenBrowser }) => {
      const status = await auth.getStatus();
      if (status.authenticated && !force) {
        return {
          alreadyAuthenticated: true,
          message: 'Already signed in to Google with the required permissions.',
        };
      }
      const session = await auth.startAuthorization();
      return {
        alreadyAuthenticated: false,
        authUrl: session.authUrl,
        expiresAt: session.expiresAt,
        browserOpened: shouldOpenBrowser ? openBrowser(session.authUrl) : false,
        instructions:
          'Ask the user to open authUrl, sign in with their Google account and approve access. The link must be opened on the machine running this server and expires at expiresAt. Afterwards call get_auth_status to confirm.',
      };
    },
  });

  register({
    name: 'sign_out',
    title: 'Sign out of Google',
    description:
      'Sign out: revoke this server’s Google access and delete the locally stored OAuth tokens. After this, every Google Docs tool fails until `authenticate` is called again. Only use it when the user explicitly asks to sign out or switch accounts.',
    inputSchema: z.strictObject({}),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async () => {
      const { revoked } = await auth.signOut();
      return { signedOut: true, revokedAtGoogle: revoked };
    },
  });
}
