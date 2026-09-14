import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError, ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const storedTokensSchema = z.object({
  access_token: z.string().nullish(),
  refresh_token: z.string().nullish(),
  expiry_date: z.number().nullish(),
  scope: z.string().nullish(),
  token_type: z.string().nullish(),
  id_token: z.string().nullish(),
  /** OAuth client ID the tokens were issued to; tokens are unusable with any other client. */
  client_id: z.string().nullish(),
});

export type StoredTokens = z.infer<typeof storedTokensSchema>;

/** Persistence for OAuth tokens. Implementations must never log token values. */
export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

/** Access tokens are treated as expired this long before their real expiry. */
export const EXPIRY_SKEW_MS = 60_000;

export function isAccessTokenExpired(tokens: StoredTokens, now: number = Date.now()): boolean {
  if (!tokens.access_token) return true;
  if (tokens.expiry_date == null) return false;
  return tokens.expiry_date <= now + EXPIRY_SKEW_MS;
}

/**
 * Merges a token update into existing tokens. Google omits the refresh token on refresh
 * responses, so an existing refresh token is kept unless a new one is issued.
 */
export function mergeTokens(existing: StoredTokens | null, update: StoredTokens): StoredTokens {
  const merged: StoredTokens = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(update) as [keyof StoredTokens, unknown][]) {
    if (value !== undefined && value !== null) Object.assign(merged, { [key]: value });
  }
  return merged;
}

/** Keeps only the known token fields (drops anything unexpected from library objects). */
export function toStoredTokens(value: unknown): StoredTokens {
  const parsed = storedTokensSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Stores tokens in a JSON file readable only by the current user (0600, directory 0700).
 * Writes are atomic (temp file + rename) so a crash never leaves a half-written token file.
 */
export class TokenManager implements TokenStore {
  constructor(private readonly filePath: string) {}

  get location(): string {
    return this.filePath;
  }

  async load(): Promise<StoredTokens | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') return null;
      logger.error('Unable to read the OAuth token file.', { error: err });
      throw new AppError(ErrorCode.CONFIG_ERROR, 'Unable to read the stored OAuth token file.', {
        cause: err,
      });
    }
    try {
      const parsed = storedTokensSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through
    }
    logger.warn('The stored OAuth token file is malformed and will be ignored.');
    return null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tempFile = path.join(directory, `.tokens-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(tempFile, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    try {
      await rename(tempFile, this.filePath);
    } catch (err) {
      await rm(tempFile, { force: true });
      throw err;
    }
    // Best effort: enforce permissions even if the file pre-existed with a looser mode.
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
