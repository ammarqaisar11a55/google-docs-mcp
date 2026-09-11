import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { logger, setLogLevel } from '../../../src/utils/logger.js';

interface LogEntry {
  time: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

describe('logger', () => {
  let stderr: MockInstance<typeof process.stderr.write>;
  let stdout: MockInstance<typeof process.stdout.write>;

  const entries = (): LogEntry[] =>
    stderr.mock.calls.map(([chunk]) => {
      const line = String(chunk);
      expect(line.endsWith('\n')).toBe(true);
      return JSON.parse(line) as LogEntry;
    });

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setLogLevel('debug');
  });

  afterEach(() => {
    setLogLevel('error');
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it('writes one JSON line per entry to stderr', () => {
    logger.info('Server started.', { port: 1 });
    logger.debug('Plain message.');
    const [first, second] = entries();
    expect(first).toMatchObject({ level: 'info', message: 'Server started.', meta: { port: 1 } });
    expect(Number.isNaN(Date.parse(first!.time))).toBe(false);
    expect(second).toMatchObject({ level: 'debug', message: 'Plain message.' });
    expect(second).not.toHaveProperty('meta');
  });

  it('never writes to stdout (reserved for the MCP protocol)', () => {
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(4);
  });

  it('filters entries below the configured level', () => {
    setLogLevel('warn');
    logger.debug('hidden debug');
    logger.info('hidden info');
    logger.warn('shown warn');
    logger.error('shown error');
    expect(entries().map((entry) => entry.level)).toEqual(['warn', 'error']);

    stderr.mockClear();
    setLogLevel('error');
    logger.warn('hidden');
    logger.error('shown');
    expect(entries().map((entry) => entry.message)).toEqual(['shown']);
  });

  it('redacts values of sensitive keys at any depth', () => {
    logger.info('tokens', {
      access_token: 'plain-access',
      refresh_token: 'plain-refresh',
      client_secret: 'plain-secret',
      authorization: 'plain-auth',
      nested: { clientSecret: 'nested-secret', codeVerifier: 'nested-verifier', safe: 'visible' },
      list: [{ idToken: 'in-array' }],
    });
    const [entry] = entries();
    expect(entry!.meta).toEqual({
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]',
      client_secret: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]', codeVerifier: '[REDACTED]', safe: 'visible' },
      list: [{ idToken: '[REDACTED]' }],
    });
    const raw = String(stderr.mock.calls[0]![0]);
    for (const secret of ['plain-', 'nested-secret', 'nested-verifier', 'in-array']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('redacts tokens embedded in messages and string values', () => {
    const accessToken = 'ya29.a0AfH6SMBx-secret';
    const refreshToken = '1//0gAbCdEfGhIjKlMnOpQrStUvWxYz';
    logger.warn(`Request with ${accessToken} failed`, {
      detail: `refresh ${refreshToken}`,
      url: 'http://127.0.0.1:53682/oauth2callback?code=4/0Secret&state=s',
      header: 'Bearer abc.def',
    });
    const raw = String(stderr.mock.calls[0]![0]);
    expect(raw).not.toContain(accessToken);
    expect(raw).not.toContain(refreshToken);
    expect(raw).not.toContain('4/0Secret');
    expect(raw).not.toContain('abc.def');
    expect(entries()[0]!.message).toBe('Request with [REDACTED] failed');
  });

  it('logs errors as name and redacted message only, without stack traces', () => {
    const error = new TypeError('failed with ya29.leaky-token');
    logger.error('Boom.', { error });
    const [entry] = entries();
    expect(entry!.meta).toEqual({
      error: { name: 'TypeError', message: 'failed with [REDACTED]' },
    });
    const raw = String(stderr.mock.calls[0]![0]);
    expect(raw).not.toContain('stack');
    expect(raw).not.toContain('logger.test');
  });

  it('truncates deeply nested metadata', () => {
    logger.info('deep', { a: { b: { c: { d: { e: { f: 'too deep' } } } } } });
    expect(JSON.stringify(entries()[0]!.meta)).toContain('[Truncated]');
    expect(JSON.stringify(entries()[0]!.meta)).not.toContain('too deep');
  });
});
