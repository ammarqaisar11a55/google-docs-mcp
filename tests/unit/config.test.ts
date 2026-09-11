import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDIRECT_URI,
  defaultTokenPath,
  DOCS_SCOPE,
  DRIVE_SCOPES,
  loadConfig,
  validateRedirectUri,
} from '../../src/config/config.js';
import { AppError, ErrorCode } from '../../src/utils/errors.js';

function captureError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('Expected the function to throw an AppError.');
}

const CLIENT_ID = '123456789-abcdefg.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-SuperSecretValue_123';

describe('loadConfig', () => {
  it('applies defaults when nothing is configured', () => {
    const config = loadConfig({});
    expect(config.google).toEqual({
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: DEFAULT_REDIRECT_URI,
      driveScope: 'drive',
      scopes: [DOCS_SCOPE, DRIVE_SCOPES.drive],
    });
    expect(config.logLevel).toBe('info');
    expect(config.tokenPath).toBe(defaultTokenPath({}));
    expect(path.isAbsolute(config.tokenPath)).toBe(true);
    expect(config.tokenPath.endsWith(path.join('google-docs-mcp', 'tokens.json'))).toBe(true);
  });

  it('reads client credentials, redirect URI and log level', () => {
    const config = loadConfig({
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: 'http://localhost:8765/callback',
      LOG_LEVEL: 'debug',
    });
    expect(config.google.clientId).toBe(CLIENT_ID);
    expect(config.google.clientSecret).toBe(CLIENT_SECRET);
    expect(config.google.redirectUri).toBe('http://localhost:8765/callback');
    expect(config.logLevel).toBe('debug');
  });

  it('trims surrounding whitespace from values', () => {
    const config = loadConfig({ GOOGLE_CLIENT_ID: `  ${CLIENT_ID}\n` });
    expect(config.google.clientId).toBe(CLIENT_ID);
  });

  it('requests the full Drive scope by default and drive.file when configured', () => {
    expect(loadConfig({ GOOGLE_DRIVE_SCOPE: 'drive' }).google.scopes).toEqual([
      DOCS_SCOPE,
      'https://www.googleapis.com/auth/drive',
    ]);
    const leastPrivilege = loadConfig({ GOOGLE_DRIVE_SCOPE: 'drive.file' });
    expect(leastPrivilege.google.driveScope).toBe('drive.file');
    expect(leastPrivilege.google.scopes).toEqual([
      DOCS_SCOPE,
      'https://www.googleapis.com/auth/drive.file',
    ]);
  });

  it('treats blank values as unset', () => {
    const config = loadConfig({
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '   ',
      GOOGLE_REDIRECT_URI: '',
      GOOGLE_TOKEN_PATH: ' ',
      GOOGLE_DRIVE_SCOPE: '',
      LOG_LEVEL: '\t',
    });
    expect(config.google.clientId).toBeUndefined();
    expect(config.google.clientSecret).toBeUndefined();
    expect(config.google.redirectUri).toBe(DEFAULT_REDIRECT_URI);
    expect(config.google.driveScope).toBe('drive');
    expect(config.tokenPath).toBe(defaultTokenPath({}));
    expect(config.logLevel).toBe('info');
  });

  it('rejects an invalid GOOGLE_DRIVE_SCOPE with CONFIG_ERROR', () => {
    const error = captureError(() => loadConfig({ GOOGLE_DRIVE_SCOPE: 'everything' }));
    expect(error.code).toBe(ErrorCode.CONFIG_ERROR);
    expect(error.message).toContain('GOOGLE_DRIVE_SCOPE');
  });

  it('rejects an invalid LOG_LEVEL with CONFIG_ERROR', () => {
    const error = captureError(() => loadConfig({ LOG_LEVEL: 'verbose' }));
    expect(error.code).toBe(ErrorCode.CONFIG_ERROR);
    expect(error.message).toContain('LOG_LEVEL');
  });

  it('rejects non-loopback, port-less and non-http redirect URIs', () => {
    for (const uri of [
      'http://example.com:8080/oauth2callback',
      'http://127.0.0.1/oauth2callback',
      'https://127.0.0.1:53682/oauth2callback',
      'http://192.168.1.10:53682/oauth2callback',
      'not a url',
    ]) {
      const error = captureError(() => loadConfig({ GOOGLE_REDIRECT_URI: uri }));
      expect(error.code, uri).toBe(ErrorCode.CONFIG_ERROR);
      expect(error.message, uri).toContain('GOOGLE_REDIRECT_URI');
    }
  });

  it('expands ~ in GOOGLE_TOKEN_PATH to the home directory', () => {
    expect(loadConfig({ GOOGLE_TOKEN_PATH: '~/secrets/tokens.json' }).tokenPath).toBe(
      path.join(os.homedir(), 'secrets', 'tokens.json'),
    );
    expect(loadConfig({ GOOGLE_TOKEN_PATH: '~' }).tokenPath).toBe(os.homedir());
  });

  it('resolves relative token paths to absolute paths', () => {
    expect(loadConfig({ GOOGLE_TOKEN_PATH: 'data/tokens.json' }).tokenPath).toBe(
      path.resolve('data/tokens.json'),
    );
  });

  it.skipIf(process.platform === 'win32')(
    'honours XDG_CONFIG_HOME for the default token path',
    () => {
      expect(loadConfig({ XDG_CONFIG_HOME: '/custom/config' }).tokenPath).toBe(
        path.join('/custom/config', 'google-docs-mcp', 'tokens.json'),
      );
    },
  );

  it('never includes secret or invalid values in error messages', () => {
    const secretLooking = 'GOCSPX-LeakedValue_987';
    const cases: NodeJS.ProcessEnv[] = [
      { GOOGLE_CLIENT_SECRET: CLIENT_SECRET, LOG_LEVEL: 'nope' },
      { GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_DRIVE_SCOPE: secretLooking },
      { GOOGLE_CLIENT_SECRET: CLIENT_SECRET, LOG_LEVEL: secretLooking },
      {
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: `http://evil.example.com:80/cb?secret=${secretLooking}`,
      },
    ];
    for (const env of cases) {
      const error = captureError(() => loadConfig(env));
      expect(error.code).toBe(ErrorCode.CONFIG_ERROR);
      expect(error.message).not.toContain(CLIENT_SECRET);
      expect(error.message).not.toContain(CLIENT_ID);
      expect(error.message).not.toContain(secretLooking);
    }
  });
});

describe('validateRedirectUri', () => {
  it('accepts loopback hosts with explicit ports', () => {
    for (const uri of [
      'http://127.0.0.1:53682/oauth2callback',
      'http://localhost:3000/cb',
      'http://[::1]:8080/oauth2callback',
    ]) {
      expect(validateRedirectUri(uri)).toBeInstanceOf(URL);
    }
  });

  it('rejects a default-port loopback URL (the port would be implicit)', () => {
    expect(captureError(() => validateRedirectUri('http://127.0.0.1:80/cb')).code).toBe(
      ErrorCode.CONFIG_ERROR,
    );
  });
});
