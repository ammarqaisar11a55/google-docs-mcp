#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { GoogleAuthManager } from './auth/google-auth.js';
import { TokenManager } from './auth/token-manager.js';
import { isDotenvEnabled, loadConfig } from './config/config.js';
import {
  createDependencies,
  createServer,
  createUnconfiguredDependencies,
  SERVER_NAME,
  SERVER_VERSION,
  type ServerDependencies,
} from './server.js';
import { toAppError } from './utils/errors.js';
import { logger, setLogLevel } from './utils/logger.js';
import { openBrowser } from './utils/open-browser.js';

const USAGE = `${SERVER_NAME} ${SERVER_VERSION}

Usage:
  google-docs-mcp            Start the MCP server on stdio (used by MCP clients)
  google-docs-mcp auth       Sign in with Google and store OAuth tokens
  google-docs-mcp status     Show the current Google sign-in status
  google-docs-mcp logout     Revoke access and delete stored tokens
  google-docs-mcp --help     Show this help
  google-docs-mcp --version  Show the version

Configuration is read from environment variables (see .env.example).`;

/**
 * Loads `.env` from the working directory and from the package root, without overriding
 * variables that are already set. Disabled with GOOGLE_DOCS_MCP_LOAD_DOTENV=false.
 */
function loadEnvFiles(): void {
  if (!isDotenvEnabled()) return;
  const candidates = new Set([
    path.resolve(process.cwd(), '.env'),
    fileURLToPath(new URL('../.env', import.meta.url)),
  ]);
  for (const file of candidates) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** CLI output goes to stderr so stdout stays clean (and never carries secrets). */
function print(message: string): void {
  process.stderr.write(`${message}\n`);
}

function createAuthManager(): GoogleAuthManager {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  return new GoogleAuthManager(config.google, new TokenManager(config.tokenPath));
}

async function runAuth(): Promise<void> {
  const auth = createAuthManager();
  const session = await auth.startAuthorization();
  print('Open this URL in your browser to sign in with Google:\n');
  print(`  ${session.authUrl}\n`);
  if (openBrowser(session.authUrl)) print('(A browser window was opened automatically.)');
  print('Waiting for Google to redirect back (up to 5 minutes)...');
  await session.completion;
  const status = await auth.getStatus();
  print(
    status.authenticated
      ? 'Success: Google Docs MCP is authorized. You can now start the server from your MCP client.'
      : `Signed in, but some permissions are missing: ${status.missingScopes.join(', ')}`,
  );
}

async function runStatus(): Promise<void> {
  const status = await createAuthManager().getStatus();
  print(JSON.stringify(status, null, 2));
}

async function runLogout(): Promise<void> {
  const { revoked } = await createAuthManager().signOut();
  print(revoked ? 'Signed out and revoked access at Google.' : 'Local tokens deleted.');
}

function createServerDependencies(): ServerDependencies {
  try {
    const config = loadConfig();
    setLogLevel(config.logLevel);
    logger.info('Configuration loaded.', {
      driveScope: config.google.driveScope,
      oauthClientConfigured: Boolean(config.google.clientId && config.google.clientSecret),
      logLevel: config.logLevel,
    });
    return createDependencies(config);
  } catch (err) {
    const error = toAppError(err);
    // Keep serving: when a server exits, hosts such as Claude Desktop only show a generic
    // failure, whereas tool results can tell the user exactly which setting is wrong.
    logger.error('Invalid configuration; tools will report the problem until it is fixed.', {
      errorCode: error.code,
      reason: error.message,
    });
    return createUnconfiguredDependencies(error);
  }
}

function runServer(): void {
  const deps = createServerDependencies();
  const handle = serveStdio(() => createServer(deps), {
    onerror: (error) => {
      logger.error('MCP transport error.', { error });
    },
  });
  logger.info(
    `${SERVER_NAME} ${SERVER_VERSION} running on stdio (Node.js ${process.version}, ${process.platform}).`,
  );

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info(`Received ${signal}; shutting down.`);
    void handle.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const command = process.argv[2];
  switch (command) {
    case undefined:
    case 'serve':
      runServer();
      return;
    case 'auth':
      await runAuth();
      return;
    case 'status':
      await runStatus();
      return;
    case 'logout':
      await runLogout();
      return;
    case '--version':
    case '-v':
      print(SERVER_VERSION);
      return;
    case '--help':
    case '-h':
      print(USAGE);
      return;
    default:
      print(`Unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().then(
  () => {
    // `auth` leaves no handles open once finished; exit explicitly in case a browser child lingers.
    if (process.argv[2] === 'auth') process.exit(0);
  },
  (err: unknown) => {
    const error = toAppError(err);
    print(`Error [${error.code}]: ${error.message}`);
    process.exit(1);
  },
);
