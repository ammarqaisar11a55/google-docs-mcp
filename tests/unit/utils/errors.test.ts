import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, ErrorCode, redact, toAppError } from '../../../src/utils/errors.js';

const ACCESS_TOKEN = 'ya29.a0AfH6SMBx-Example_Access.Token123';
const REFRESH_TOKEN = '1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-_0123';
const CLIENT_SECRET = 'GOCSPX-AbCdEf123_-xyz';

/** Builds an error shaped like a Gaxios error from a Google API. */
function googleApiError(
  status: number,
  body: { message?: string; status?: string; reasons?: string[]; detailReasons?: string[] } = {},
): Record<string, unknown> {
  return {
    name: 'GaxiosError',
    message: body.message ?? `Request failed with status code ${status}`,
    status,
    response: {
      status,
      data: {
        error: {
          code: status,
          message: body.message,
          status: body.status,
          errors: (body.reasons ?? []).map((reason) => ({ reason, domain: 'global' })),
          details: (body.detailReasons ?? []).map((reason) => ({
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason,
          })),
        },
      },
    },
  };
}

describe('toAppError: HTTP status mapping', () => {
  it('maps 400 to INVALID_REQUEST and includes Google’s (redacted) message', () => {
    const error = toAppError(
      googleApiError(400, {
        message: `Invalid requests[0].insertText: Index 50 must be less than the end index. token=${ACCESS_TOKEN}`,
      }),
    );
    expect(error.code).toBe(ErrorCode.INVALID_REQUEST);
    expect(error.message).toContain('Index 50 must be less than the end index');
    expect(error.message).not.toContain(ACCESS_TOKEN);
    expect(error.retryable).toBe(false);
  });

  it('maps 400 without a Google message to a generic INVALID_REQUEST', () => {
    const error = toAppError({ status: 400 });
    expect(error.code).toBe(ErrorCode.INVALID_REQUEST);
    expect(error.message).toContain('the request was invalid');
  });

  it('maps 401 to AUTH_EXPIRED with a re-authentication hint', () => {
    const error = toAppError(googleApiError(401, { message: 'Invalid Credentials' }));
    expect(error.code).toBe(ErrorCode.AUTH_EXPIRED);
    expect(error.message).toContain('authenticate');
    expect(error.retryable).toBe(false);
  });

  it('maps 403 rateLimitExceeded / userRateLimitExceeded / RESOURCE_EXHAUSTED to RATE_LIMITED', () => {
    for (const err of [
      googleApiError(403, { reasons: ['rateLimitExceeded'] }),
      googleApiError(403, { reasons: ['userRateLimitExceeded'] }),
      googleApiError(403, { status: 'RESOURCE_EXHAUSTED' }),
    ]) {
      const error = toAppError(err);
      expect(error.code).toBe(ErrorCode.RATE_LIMITED);
      expect(error.retryable).toBe(true);
    }
  });

  it('maps 403 SERVICE_DISABLED / accessNotConfigured to CONFIG_ERROR', () => {
    for (const err of [
      googleApiError(403, { status: 'PERMISSION_DENIED', detailReasons: ['SERVICE_DISABLED'] }),
      googleApiError(403, { reasons: ['accessNotConfigured'] }),
    ]) {
      const error = toAppError(err);
      expect(error.code).toBe(ErrorCode.CONFIG_ERROR);
      expect(error.message).toContain('not enabled');
      expect(error.retryable).toBe(false);
    }
  });

  it('maps 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT to PERMISSION_DENIED with a re-auth hint', () => {
    const error = toAppError(
      googleApiError(403, {
        status: 'PERMISSION_DENIED',
        detailReasons: ['ACCESS_TOKEN_SCOPE_INSUFFICIENT'],
      }),
    );
    expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
    expect(error.message).toContain('authenticate');
  });

  it('maps a plain 403 to PERMISSION_DENIED', () => {
    const error = toAppError(
      googleApiError(403, { message: 'The caller does not have permission' }),
    );
    expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
    expect(error.message).toContain('do not have permission');
    expect(error.retryable).toBe(false);
  });

  it('maps 404 to DOCUMENT_NOT_FOUND', () => {
    const error = toAppError(googleApiError(404, { message: 'Requested entity was not found.' }));
    expect(error.code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    expect(error.message).toBe(
      'The Google Docs document could not be found or you do not have access to it.',
    );
  });

  it('maps 408 to a retryable NETWORK_ERROR', () => {
    const error = toAppError({ status: 408 });
    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('maps 429 to a retryable RATE_LIMITED', () => {
    const error = toAppError(googleApiError(429));
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.retryable).toBe(true);
  });

  it('maps 5xx to a retryable GOOGLE_API_ERROR', () => {
    for (const status of [500, 502, 503]) {
      const error = toAppError(googleApiError(status));
      expect(error.code).toBe(ErrorCode.GOOGLE_API_ERROR);
      expect(error.message).toContain(String(status));
      expect(error.retryable).toBe(true);
    }
  });

  it('maps other statuses to GOOGLE_API_ERROR', () => {
    expect(toAppError({ status: 409 }).code).toBe(ErrorCode.GOOGLE_API_ERROR);
  });

  it('reads the status from response.status or a numeric string code', () => {
    expect(toAppError({ response: { status: 404 } }).code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    expect(toAppError({ code: '404' }).code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    expect(toAppError({ status: '429' }).code).toBe(ErrorCode.RATE_LIMITED);
  });

  it('keeps the original error as cause', () => {
    const original = googleApiError(404);
    expect(toAppError(original).cause).toBe(original);
  });
});

describe('toAppError: OAuth errors', () => {
  it('maps response.data.error = invalid_grant to AUTH_EXPIRED (even with HTTP 400)', () => {
    const error = toAppError({
      status: 400,
      message: 'invalid_grant',
      response: {
        status: 400,
        data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
      },
    });
    expect(error.code).toBe(ErrorCode.AUTH_EXPIRED);
    expect(error.message).toContain('expired or was revoked');
    expect(error.retryable).toBe(false);
  });

  it('detects invalid_grant in the error message alone', () => {
    expect(toAppError(new Error('invalid_grant')).code).toBe(ErrorCode.AUTH_EXPIRED);
  });

  it('maps invalid_client / unauthorized_client to INVALID_CREDENTIALS', () => {
    for (const oauthError of ['invalid_client', 'unauthorized_client']) {
      const error = toAppError({
        status: 401,
        response: { status: 401, data: { error: oauthError, error_description: 'Unauthorized' } },
      });
      expect(error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      expect(error.message).toContain('GOOGLE_CLIENT_ID');
    }
  });

  it('maps other OAuth token-endpoint errors by status and redacts the description', () => {
    const error = toAppError({
      status: 400,
      response: {
        status: 400,
        data: { error: 'invalid_request', error_description: `Bad code_verifier=${REFRESH_TOKEN}` },
      },
    });
    expect(error.code).toBe(ErrorCode.INVALID_REQUEST);
    expect(error.message).not.toContain(REFRESH_TOKEN);
  });
});

describe('toAppError: network errors', () => {
  it.each([
    ['ECONNRESET code', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
    ['ENOTFOUND code', Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' })],
    ['plain object code', { code: 'ETIMEDOUT' }],
    ['cause.code', new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })],
    ['nested cause without code', new TypeError('fetch failed')],
    ['socket hang up', new Error('socket hang up')],
    ['AbortError', Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ])('maps %s to a retryable NETWORK_ERROR', (_label, err) => {
    const error = toAppError(err);
    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('Could not reach Google');
  });
});

describe('toAppError: other values', () => {
  it('returns AppError instances unchanged', () => {
    const original = new AppError(ErrorCode.INVALID_INDEX, 'bad index');
    expect(toAppError(original)).toBe(original);
  });

  it('maps ZodError to INVALID_ARGUMENT with the issue paths', () => {
    const result = z.object({ title: z.string(), nested: z.object({ n: z.number() }) }).safeParse({
      nested: { n: 'x' },
    });
    expect(result.success).toBe(false);
    const error = toAppError(result.error);
    expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
    expect(error.message).toContain('title');
    expect(error.message).toContain('nested.n');
    expect(error.retryable).toBe(false);
  });

  it('maps root-level ZodError issues to (root)', () => {
    const result = z.string().safeParse(1);
    expect(toAppError(result.error).message).toContain('(root)');
  });

  it.each([
    ['a string', 'boom'],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
  ])('maps %s to INTERNAL_ERROR', (_label, value) => {
    const error = toAppError(value);
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.retryable).toBe(false);
  });

  it('never exposes the message or stack of unknown errors', () => {
    const original = new Error(
      `Unexpected failure with refresh_token=${REFRESH_TOKEN} at /home/user`,
    );
    const error = toAppError(original);
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.message).not.toContain(REFRESH_TOKEN);
    expect(error.message).not.toContain('/home/user');
    expect(JSON.stringify(error.toBody())).not.toContain('stack');
  });
});

describe('AppError', () => {
  it('serialises to a safe body with details only when present', () => {
    expect(new AppError(ErrorCode.INVALID_INDEX, 'bad').toBody()).toEqual({
      code: 'INVALID_INDEX',
      message: 'bad',
      retryable: false,
    });
    expect(
      new AppError(ErrorCode.INVALID_INDEX, 'bad', { details: { maxIndex: 3 } }).toBody(),
    ).toEqual({
      code: 'INVALID_INDEX',
      message: 'bad',
      retryable: false,
      details: { maxIndex: 3 },
    });
  });

  it('flags only transient errors as retryable', () => {
    const retryable = Object.values(ErrorCode).filter((code) => new AppError(code, 'x').retryable);
    expect(retryable.sort()).toEqual(['GOOGLE_API_ERROR', 'NETWORK_ERROR', 'RATE_LIMITED']);
  });
});

describe('redact', () => {
  it('removes Google access tokens', () => {
    expect(redact(`token ${ACCESS_TOKEN} used`)).toBe('token [REDACTED] used');
  });

  it('removes Google refresh tokens', () => {
    expect(redact(`refresh with ${REFRESH_TOKEN}`)).toBe('refresh with [REDACTED]');
  });

  it('removes OAuth client secrets', () => {
    expect(redact(`secret ${CLIENT_SECRET}`)).toBe('secret [REDACTED]');
  });

  it('removes key=value and JSON token fields', () => {
    expect(redact('access_token=abc123&expires_in=3599')).toBe(
      'access_token=[REDACTED]&expires_in=3599',
    );
    expect(redact('{"refresh_token": "abc", "scope": "x"}')).toBe(
      '{"refresh_token": "[REDACTED]", "scope": "x"}',
    );
    expect(redact("client_secret: 'topsecret'")).toBe("client_secret: '[REDACTED]'");
    expect(redact('authorization_code=zzz code_verifier=yyy')).toBe(
      'authorization_code=[REDACTED] code_verifier=[REDACTED]',
    );
  });

  it('removes authorization codes from URLs', () => {
    expect(redact('http://127.0.0.1:53682/oauth2callback?code=4/0AbCdEf&state=xyz')).toBe(
      'http://127.0.0.1:53682/oauth2callback?code=[REDACTED]&state=xyz',
    );
    expect(redact('/cb?state=1&code=4/0Ab')).toBe('/cb?state=1&code=[REDACTED]');
  });

  it('removes bearer tokens from headers', () => {
    expect(redact('Authorization: Bearer abc.def-ghi_jkl==')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Index 12 is outside the document body (max 11). Document 1AbC_def-123.';
    expect(redact(text)).toBe(text);
  });
});
