import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPES, isDotenvEnabled, loadConfig } from '../../src/config/config.js';
import { AppError, ErrorCode } from '../../src/utils/errors.js';

const base = { GOOGLE_TOKEN_PATH: '/tmp/google-docs-mcp-test/tokens.json' };

describe('configuration used by the Claude Desktop extension', () => {
  it('treats unresolved ${user_config.*} placeholders as unset', () => {
    const config = loadConfig({
      ...base,
      GOOGLE_CLIENT_ID: '${user_config.google_client_id}',
      GOOGLE_CLIENT_SECRET: ' ${user_config.google_client_secret} ',
      GOOGLE_DRIVE_FILE_ONLY: '${user_config.limit_drive_access}',
      GOOGLE_DOCS_MCP_DEBUG: '${user_config.debug_logging}',
    });
    expect(config.google.clientId).toBeUndefined();
    expect(config.google.clientSecret).toBeUndefined();
    expect(config.google.driveScope).toBe('drive');
    expect(config.logLevel).toBe('info');
  });

  it.each([
    ['true', 'drive.file'],
    ['TRUE', 'drive.file'],
    ['1', 'drive.file'],
    ['yes', 'drive.file'],
    ['false', 'drive'],
    ['0', 'drive'],
    ['no', 'drive'],
    ['', 'drive'],
  ] as const)('GOOGLE_DRIVE_FILE_ONLY=%j selects the %s scope', (value, scope) => {
    const config = loadConfig({ ...base, GOOGLE_DRIVE_FILE_ONLY: value });
    expect(config.google.driveScope).toBe(scope);
    expect(config.google.scopes).toContain(DRIVE_SCOPES[scope]);
  });

  it('lets GOOGLE_DRIVE_SCOPE take precedence over GOOGLE_DRIVE_FILE_ONLY', () => {
    const config = loadConfig({
      ...base,
      GOOGLE_DRIVE_SCOPE: 'drive',
      GOOGLE_DRIVE_FILE_ONLY: 'true',
    });
    expect(config.google.driveScope).toBe('drive');
  });

  it('rejects an invalid boolean flag with CONFIG_ERROR', () => {
    let caught: unknown;
    try {
      loadConfig({ ...base, GOOGLE_DRIVE_FILE_ONLY: 'maybe' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCode.CONFIG_ERROR);
    expect((caught as AppError).message).toContain('GOOGLE_DRIVE_FILE_ONLY');
  });

  it('enables debug logging with GOOGLE_DOCS_MCP_DEBUG unless LOG_LEVEL is set', () => {
    expect(loadConfig({ ...base, GOOGLE_DOCS_MCP_DEBUG: 'true' }).logLevel).toBe('debug');
    expect(loadConfig({ ...base, GOOGLE_DOCS_MCP_DEBUG: 'false' }).logLevel).toBe('info');
    expect(loadConfig({ ...base, GOOGLE_DOCS_MCP_DEBUG: 'true', LOG_LEVEL: 'warn' }).logLevel).toBe(
      'warn',
    );
  });

  it('builds the redirect URI port from the extension setting', () => {
    const config = loadConfig({
      ...base,
      GOOGLE_REDIRECT_URI: 'http://127.0.0.1:54000/oauth2callback',
    });
    expect(config.google.redirectUri).toBe('http://127.0.0.1:54000/oauth2callback');
  });

  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['no', false],
  ])('isDotenvEnabled with GOOGLE_DOCS_MCP_LOAD_DOTENV=%j is %s', (value, expected) => {
    const env = value === undefined ? {} : { GOOGLE_DOCS_MCP_LOAD_DOTENV: value };
    expect(isDotenvEnabled(env)).toBe(expected);
  });
});
