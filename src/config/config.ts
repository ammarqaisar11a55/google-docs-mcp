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

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_REDIRECT_URI: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_TOKEN_PATH: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_DRIVE_SCOPE: z.preprocess(blankToUndefined, z.enum(['drive', 'drive.file']).optional()),
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
  const driveScope: DriveScopeMode = values.GOOGLE_DRIVE_SCOPE ?? 'drive';

  return {
    google: {
      clientId: values.GOOGLE_CLIENT_ID,
      clientSecret: values.GOOGLE_CLIENT_SECRET,
      redirectUri,
      driveScope,
      scopes: [DOCS_SCOPE, DRIVE_SCOPES[driveScope]],
    },
    tokenPath: resolveTokenPath(values.GOOGLE_TOKEN_PATH, env),
    logLevel: values.LOG_LEVEL ?? 'info',
  };
}
