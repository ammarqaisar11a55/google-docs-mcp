import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { type AuthService, GoogleAuthManager } from './auth/google-auth.js';
import { TokenManager } from './auth/token-manager.js';
import type { AppConfig } from './config/config.js';
import { GoogleDocsClient } from './google/docs-client.js';
import { GoogleDriveClient } from './google/drive-client.js';
import { registerPrompts } from './prompts/index.js';
import { registerDocumentResources } from './resources/documents.js';
import { createServices, type Services } from './services/index.js';
import { registerAuthTools } from './tools/auth/index.js';
import { registerContentTools } from './tools/content/index.js';
import { createToolRegistrar } from './tools/define-tool.js';
import { registerDocumentTools } from './tools/documents/index.js';
import { registerFormattingTools } from './tools/formatting/index.js';
import { registerSearchTools } from './tools/search/index.js';
import { registerStructureTools } from './tools/structure/index.js';
import { UnavailableAuthService } from './auth/unavailable-auth.js';
import { type AppError, ErrorCode } from './utils/errors.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

export const SERVER_NAME = 'google-docs-mcp';
export const SERVER_VERSION = packageJson.version;

const SERVER_INSTRUCTIONS = `Google Docs MCP gives you access to the user's Google Docs through the Google Docs and Drive APIs.

- Sign-in: if a tool fails with NOT_AUTHENTICATED or AUTH_EXPIRED, call \`authenticate\`, show the returned authUrl to the user, and call \`get_auth_status\` after they approve.
- Finding documents: \`search_documents\` (name and/or content) or \`list_documents\` (recent documents). Every tool also accepts a full Google Docs URL as documentId.
- Reading: \`get_document\` returns the text, \`bodyEndIndex\` and a structure outline with exact start/end indexes; \`find_text\` returns the exact indexes of a phrase.
- Indexes are UTF-16 offsets and the body starts at index 1. Every insert or delete shifts the indexes after it, so when making several index-based edits, apply them from the end of the document towards the beginning, or re-read the document between edits.
- \`append_text\` and \`insert_text\` return the range of the new text, so you can format it immediately without re-reading.
- Pass \`expectedText\` to \`delete_text\` so the deletion is refused if the document changed since you read the indexes.
- Prefer \`append_text\` and \`replace_text\` when exact positions are not needed.
- \`delete_document\` only moves a document to the Drive trash. Confirm with the user before destructive operations whenever the target is ambiguous.`;

export interface ServerDependencies {
  auth: AuthService;
  services: Services;
}

/** Builds a fully configured MCP server. Pure wiring: all behaviour lives in the injected deps. */
export function createServer(deps: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  const register = createToolRegistrar(server, {
    onError: (error) => {
      // Force a fresh read of the token store next time (e.g. after re-auth from the CLI).
      if (error.code === ErrorCode.AUTH_EXPIRED || error.code === ErrorCode.NOT_AUTHENTICATED) {
        deps.auth.invalidate();
      }
    },
  });

  registerAuthTools(register, deps.auth);
  registerDocumentTools(register, deps.services);
  registerContentTools(register, deps.services);
  registerFormattingTools(register, deps.services);
  registerStructureTools(register, deps.services);
  registerSearchTools(register, deps.services);
  registerDocumentResources(server, deps.services);
  registerPrompts(server);

  return server;
}

/** Wires the real Google implementations from configuration. */
export function createDependencies(config: AppConfig): ServerDependencies {
  const auth = new GoogleAuthManager(config.google, new TokenManager(config.tokenPath));
  const services = createServices(new GoogleDocsClient(auth), new GoogleDriveClient(auth));
  return { auth, services };
}

/**
 * Wiring used when the configuration is invalid: all tools stay registered, and every Google
 * operation fails with the configuration error so the user learns exactly what to fix.
 */
export function createUnconfiguredDependencies(error: AppError): ServerDependencies {
  const auth = new UnavailableAuthService(error);
  const services = createServices(new GoogleDocsClient(auth), new GoogleDriveClient(auth));
  return { auth, services };
}
