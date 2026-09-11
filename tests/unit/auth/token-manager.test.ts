import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPIRY_SKEW_MS,
  isAccessTokenExpired,
  mergeTokens,
  type StoredTokens,
  TokenManager,
  toStoredTokens,
} from '../../../src/auth/token-manager.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';

const isWindows = process.platform === 'win32';

const TOKENS: StoredTokens = {
  access_token: 'ya29.test-access-token',
  refresh_token: '1//test-refresh-token-abcdefghijklmnop',
  expiry_date: 1_900_000_000_000,
  scope: 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive',
  token_type: 'Bearer',
};

describe('TokenManager', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'google-docs-mcp-tokens-'));
    filePath = path.join(dir, 'nested', 'config', 'tokens.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no token file exists', async () => {
    await expect(new TokenManager(filePath).load()).resolves.toBeNull();
  });

  it('exposes the token file location', () => {
    expect(new TokenManager(filePath).location).toBe(filePath);
  });

  it('round-trips tokens through save and load', async () => {
    const manager = new TokenManager(filePath);
    await manager.save(TOKENS);
    await expect(manager.load()).resolves.toEqual(TOKENS);
    // A fresh instance reads the same file.
    await expect(new TokenManager(filePath).load()).resolves.toEqual(TOKENS);
  });

  it('writes atomically without leaving temporary files behind', async () => {
    const manager = new TokenManager(filePath);
    await manager.save(TOKENS);
    await manager.save({ ...TOKENS, access_token: 'ya29.second' });
    expect(await readdir(path.dirname(filePath))).toEqual(['tokens.json']);
    await expect(manager.load()).resolves.toMatchObject({ access_token: 'ya29.second' });
  });

  it.skipIf(isWindows)('creates the file with mode 0600 inside a 0700 directory', async () => {
    await new TokenManager(filePath).save(TOKENS);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
  });

  it.skipIf(isWindows)('tightens the mode of a pre-existing token file', async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{}');
    await chmod(filePath, 0o644);
    await new TokenManager(filePath).save(TOKENS);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it('ignores malformed JSON', async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{ not json');
    await expect(new TokenManager(filePath).load()).resolves.toBeNull();
  });

  it('ignores JSON with the wrong shape', async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    for (const content of ['[]', '"text"', 'null', '{"access_token": 42}']) {
      await writeFile(filePath, content);
      await expect(new TokenManager(filePath).load(), content).resolves.toBeNull();
    }
  });

  it('drops unknown fields when loading', async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ...TOKENS, unexpected: 'value' }));
    await expect(new TokenManager(filePath).load()).resolves.toEqual(TOKENS);
  });

  it('reports unreadable token files as CONFIG_ERROR', async () => {
    // A directory at the token path cannot be read as a file (EISDIR).
    await mkdir(filePath, { recursive: true });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const error = await new TokenManager(filePath).load().catch((err: unknown) => err);
    stderr.mockRestore();
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFIG_ERROR);
    expect((error as AppError).message).not.toContain(dir);
  });

  it('clear removes the token file and is idempotent', async () => {
    const manager = new TokenManager(filePath);
    await manager.save(TOKENS);
    await manager.clear();
    await expect(manager.load()).resolves.toBeNull();
    await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(manager.clear()).resolves.toBeUndefined();
  });
});

describe('mergeTokens', () => {
  it('keeps the existing refresh token when the update omits it', () => {
    const merged = mergeTokens(TOKENS, {
      access_token: 'ya29.refreshed',
      expiry_date: 2_000_000_000_000,
    });
    expect(merged).toEqual({
      ...TOKENS,
      access_token: 'ya29.refreshed',
      expiry_date: 2_000_000_000_000,
    });
  });

  it('ignores null and undefined values in the update', () => {
    const merged = mergeTokens(TOKENS, { refresh_token: null, scope: undefined });
    expect(merged.refresh_token).toBe(TOKENS.refresh_token);
    expect(merged.scope).toBe(TOKENS.scope);
  });

  it('replaces the refresh token when a new one is issued', () => {
    expect(mergeTokens(TOKENS, { refresh_token: '1//new' }).refresh_token).toBe('1//new');
  });

  it('works without existing tokens and does not mutate its inputs', () => {
    const existing = { ...TOKENS };
    const update: StoredTokens = { access_token: 'ya29.x' };
    expect(mergeTokens(null, update)).toEqual(update);
    mergeTokens(existing, update);
    expect(existing).toEqual(TOKENS);
  });
});

describe('toStoredTokens', () => {
  it('keeps only known token fields', () => {
    expect(toStoredTokens({ ...TOKENS, res: { headers: {} } })).toEqual(TOKENS);
  });

  it('returns an empty object for invalid input', () => {
    expect(toStoredTokens('nope')).toEqual({});
    expect(toStoredTokens({ access_token: 1 })).toEqual({});
  });
});

describe('isAccessTokenExpired', () => {
  const now = 1_800_000_000_000;

  it('treats a missing access token as expired', () => {
    expect(isAccessTokenExpired({ refresh_token: 'r' }, now)).toBe(true);
  });

  it('treats a token without expiry as valid', () => {
    expect(isAccessTokenExpired({ access_token: 'a' }, now)).toBe(false);
  });

  it('applies the expiry skew', () => {
    expect(isAccessTokenExpired({ access_token: 'a', expiry_date: now - 1 }, now)).toBe(true);
    expect(
      isAccessTokenExpired({ access_token: 'a', expiry_date: now + EXPIRY_SKEW_MS }, now),
    ).toBe(true);
    expect(
      isAccessTokenExpired({ access_token: 'a', expiry_date: now + EXPIRY_SKEW_MS + 1 }, now),
    ).toBe(false);
    expect(isAccessTokenExpired({ access_token: 'a', expiry_date: now + 3_600_000 }, now)).toBe(
      false,
    );
  });
});
