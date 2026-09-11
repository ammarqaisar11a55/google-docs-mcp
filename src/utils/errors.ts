import { ZodError } from 'zod';

/** Stable, machine-readable error codes returned to MCP clients. */
export const ErrorCode = {
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CONFIG_ERROR: 'CONFIG_ERROR',
  INVALID_DOCUMENT_ID: 'INVALID_DOCUMENT_ID',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_INDEX: 'INVALID_INDEX',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  GOOGLE_API_ERROR: 'GOOGLE_API_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const RETRYABLE_CODES = new Set<ErrorCode>([
  ErrorCode.RATE_LIMITED,
  ErrorCode.NETWORK_ERROR,
  ErrorCode.GOOGLE_API_ERROR,
]);

export const REAUTH_HINT =
  'Call the `authenticate` tool (or run `google-docs-mcp auth` in a terminal) to sign in with Google again.';

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/** An error that is safe to show to an AI agent: messages never contain secrets or stack traces. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  toBody(): ErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

const REDACTIONS: readonly [RegExp, string][] = [
  [/ya29\.[0-9A-Za-z_\-.]+/g, '[REDACTED]'], // Google access tokens
  [/1\/\/[0-9A-Za-z_-]{20,}/g, '[REDACTED]'], // Google refresh tokens
  [/GOCSPX-[0-9A-Za-z_-]+/g, '[REDACTED]'], // Google OAuth client secrets
  [
    /\b(access_token|refresh_token|client_secret|id_token|authorization_code|code_verifier)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
    '$1$2[REDACTED]',
  ],
  [/([?&]code=)[^&\s"']+/gi, '$1[REDACTED]'],
  [/(Bearer\s+)[0-9A-Za-z_\-.~+/]+=*/gi, '$1[REDACTED]'],
];

/** Removes OAuth tokens, client secrets and authorization codes from free text. */
export function redact(text: string): string {
  return REDACTIONS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function toHttpStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && value >= 100 && value < 600) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

function getHttpStatus(err: UnknownRecord): number | undefined {
  const response = isRecord(err.response) ? err.response : undefined;
  return toHttpStatus(err.status) ?? toHttpStatus(response?.status) ?? toHttpStatus(err.code);
}

interface GoogleErrorInfo {
  message: string | undefined;
  reasons: string[];
  oauthError: string | undefined;
}

function getGoogleErrorInfo(err: UnknownRecord): GoogleErrorInfo {
  const info: GoogleErrorInfo = { message: undefined, reasons: [], oauthError: undefined };
  const response = isRecord(err.response) ? err.response : undefined;
  const data = response?.data;

  if (isRecord(data)) {
    if (typeof data.error === 'string') {
      // OAuth token endpoint format: { error: 'invalid_grant', error_description: '...' }
      info.oauthError = data.error;
      if (typeof data.error_description === 'string') info.message = data.error_description;
    } else if (isRecord(data.error)) {
      // Google API format: { error: { code, message, status, errors: [{ reason }], details: [{ reason }] } }
      const body = data.error;
      if (typeof body.message === 'string') info.message = body.message;
      if (typeof body.status === 'string') info.reasons.push(body.status);
      for (const list of [body.errors, body.details]) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (isRecord(item) && typeof item.reason === 'string') info.reasons.push(item.reason);
        }
      }
    }
  }

  if (!info.oauthError && typeof err.message === 'string') {
    const match = /\b(invalid_grant|invalid_client|unauthorized_client)\b/.exec(err.message);
    if (match) info.oauthError = match[1];
  }
  return info;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isNetworkError(err: UnknownRecord): boolean {
  const cause = isRecord(err.cause) ? err.cause : undefined;
  for (const code of [err.code, err.errno, cause?.code]) {
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
  }
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return (
    typeof err.message === 'string' && /fetch failed|socket hang up|network/i.test(err.message)
  );
}

const RATE_LIMIT_REASONS = [
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
  'RESOURCE_EXHAUSTED',
  'RATE_LIMIT_EXCEEDED',
];
const SERVICE_DISABLED_REASONS = ['accessNotConfigured', 'SERVICE_DISABLED'];
const SCOPE_REASONS = [
  'insufficientPermissions',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'insufficientScopes',
];

function hasReason(info: GoogleErrorInfo, reasons: readonly string[]): boolean {
  return info.reasons.some((reason) => reasons.includes(reason));
}

const NOT_FOUND_MESSAGE =
  'The Google Docs document could not be found or you do not have access to it.';

function fromHttpStatus(status: number, info: GoogleErrorInfo, cause: unknown): AppError {
  switch (status) {
    case 400:
      return new AppError(
        ErrorCode.INVALID_REQUEST,
        `Google rejected the request: ${redact(info.message ?? 'the request was invalid')}`,
        { cause },
      );
    case 401:
      return new AppError(
        ErrorCode.AUTH_EXPIRED,
        `Google authentication is no longer valid. ${REAUTH_HINT}`,
        { cause },
      );
    case 403:
      if (hasReason(info, RATE_LIMIT_REASONS)) {
        return new AppError(
          ErrorCode.RATE_LIMITED,
          'Google API rate limit or quota exceeded. Wait a moment and try again.',
          { cause },
        );
      }
      if (hasReason(info, SERVICE_DISABLED_REASONS)) {
        return new AppError(
          ErrorCode.CONFIG_ERROR,
          'The Google Docs API or Google Drive API is not enabled for the configured Google Cloud project. Enable both APIs in Google Cloud Console and try again.',
          { cause },
        );
      }
      if (hasReason(info, SCOPE_REASONS)) {
        return new AppError(
          ErrorCode.PERMISSION_DENIED,
          `The granted Google permissions do not allow this operation. ${REAUTH_HINT}`,
          { cause },
        );
      }
      return new AppError(
        ErrorCode.PERMISSION_DENIED,
        'You do not have permission to perform this operation on the Google Docs document.',
        { cause },
      );
    case 404:
      return new AppError(ErrorCode.DOCUMENT_NOT_FOUND, NOT_FOUND_MESSAGE, { cause });
    case 408:
      return new AppError(ErrorCode.NETWORK_ERROR, 'The request to Google timed out.', { cause });
    case 429:
      return new AppError(
        ErrorCode.RATE_LIMITED,
        'Google API rate limit exceeded. Wait a moment and try again.',
        { cause },
      );
    default:
      if (status >= 500) {
        return new AppError(
          ErrorCode.GOOGLE_API_ERROR,
          `Google API is temporarily unavailable (HTTP ${status}). Try again shortly.`,
          { cause },
        );
      }
      return new AppError(
        ErrorCode.GOOGLE_API_ERROR,
        `Google API request failed with HTTP ${status}.`,
        { cause },
      );
  }
}

/**
 * Converts any thrown value (Google API/Gaxios errors, OAuth errors, network failures, Zod errors)
 * into a safe {@link AppError}. The original error is kept as `cause` for server-side logging only.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    });
    return new AppError(ErrorCode.INVALID_ARGUMENT, `Invalid arguments. ${issues.join('; ')}`, {
      cause: err,
    });
  }

  if (!isRecord(err)) {
    return new AppError(ErrorCode.INTERNAL_ERROR, 'An unexpected internal error occurred.', {
      cause: err,
    });
  }

  const info = getGoogleErrorInfo(err);
  if (info.oauthError === 'invalid_grant') {
    return new AppError(
      ErrorCode.AUTH_EXPIRED,
      `Your Google authorization has expired or was revoked. ${REAUTH_HINT}`,
      { cause: err },
    );
  }
  if (info.oauthError === 'invalid_client' || info.oauthError === 'unauthorized_client') {
    return new AppError(
      ErrorCode.INVALID_CREDENTIALS,
      'Google rejected the OAuth client credentials. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      { cause: err },
    );
  }

  const status = getHttpStatus(err);
  if (status !== undefined) return fromHttpStatus(status, info, err);

  if (isNetworkError(err)) {
    return new AppError(
      ErrorCode.NETWORK_ERROR,
      'Could not reach Google APIs. Check the network connection and try again.',
      { cause: err },
    );
  }

  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    'An unexpected internal error occurred. Check the server logs for details.',
    { cause: err },
  );
}
