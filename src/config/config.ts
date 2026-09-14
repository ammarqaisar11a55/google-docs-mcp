import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { AppError, ErrorCode } from '../utils/errors.js';

export const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';
export const DRIVE_SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive',
  'drive.file': 'https://www.googleapis.com/auth/drive.file',
} as const;

export type DriveScopeMode = keyof typeof DRIVE_SCOPES;

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:53682/oauth2callback';

export interface GoogleOAuthConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  driveScope: DriveScopeMode;
  scopes: readonly string[];
}

export interface AppConfig {
  google: GoogleOAuthConfig;
  tokenPath: string;
  logLevel: LogLevel;
}

/**
 * MCP hosts such as Claude Desktop substitute `${user_config.*}` placeholders in the server
 * environment. A placeholder that reaches the process unresolved means "not configured".
 */
const UNRESOLVED_PLACEHOLDER = /^\$\{[^}]*\}$/;

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' || UNRESOLVED_PLACEHOLDER.test(trimmed) ? undefined : trimmed;
};

const TRUE_VALUES = new Set(['true', '1', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'no']);

const booleanFlag = z
  .preprocess(
    (value) => {
      const normalized = blankToUndefined(value);
      return typeof normalized === 'string' ? normalized.toLowerCase() : normalized;
    },
    z.enum(['true', 'false', '1', '0', 'yes', 'no']).optional(),
  )
  .transform((value) => (value === undefined ? undefined : TRUE_VALUES.has(value)));

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_REDIRECT_URI: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_TOKEN_PATH: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_DRIVE_SCOPE: z.preprocess(blankToUndefined, z.enum(['drive', 'drive.file']).optional()),
  GOOGLE_DRIVE_FILE_ONLY: booleanFlag,
  GOOGLE_DOCS_MCP_DEBUG: booleanFlag,
  LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(LOG_LEVELS).optional()),
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The OAuth redirect must be a loopback URL with an explicit port (Desktop-app OAuth flow). */
export function validateRedirectUri(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(ErrorCode.CONFIG_ERROR, 'GOOGLE_REDIRECT_URI is not a valid URL.');
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.port === '') {
    throw new AppError(
      ErrorCode.CONFIG_ERROR,
      'GOOGLE_REDIRECT_URI must be a loopback URL with an explicit port, e.g. http://127.0.0.1:53682/oauth2callback.',
    );
  }
  return url;
}

export function defaultTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : (env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return path.join(base, 'google-docs-mcp', 'tokens.json');
}

function resolveTokenPath(raw: string | undefined, env: NodeJS.ProcessEnv): string {
  if (!raw) return defaultTokenPath(env);
  const expanded =
    raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(expanded);
}

/**
 * Whether `.env` files may be loaded. The Claude Desktop extension disables this, because all
 * of its settings come from the host and a stray `.env` file must not change them.
 */
export function isDotenvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = blankToUndefined(env.GOOGLE_DOCS_MCP_LOAD_DOTENV);
  return !(typeof value === 'string' && FALSE_VALUES.has(value.toLowerCase()));
}

/** Loads and validates configuration from environment variables. Never includes values in errors. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new AppError(ErrorCode.CONFIG_ERROR, `Invalid configuration. ${problems.join('; ')}`);
  }
  const values = parsed.data;
  const redirectUri = values.GOOGLE_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  validateRedirectUri(redirectUri);
  const driveScope: DriveScopeMode =
    values.GOOGLE_DRIVE_SCOPE ?? (values.GOOGLE_DRIVE_FILE_ONLY ? 'drive.file' : 'drive');

  return {
    google: {
      clientId: values.GOOGLE_CLIENT_ID,
      clientSecret: values.GOOGLE_CLIENT_SECRET,
      redirectUri,
      driveScope,
      scopes: [DOCS_SCOPE, DRIVE_SCOPES[driveScope]],
    },
    tokenPath: resolveTokenPath(values.GOOGLE_TOKEN_PATH, env),
    logLevel: values.LOG_LEVEL ?? (values.GOOGLE_DOCS_MCP_DEBUG ? 'debug' : 'info'),
  };
}
