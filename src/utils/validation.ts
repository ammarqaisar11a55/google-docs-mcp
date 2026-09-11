import { AppError, ErrorCode } from './errors.js';

/** Google Docs IDs are URL-safe base64-like strings (typically 44 characters). */
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const DOCUMENT_URL_PATTERN = /\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/;

/**
 * Accepts a raw document ID or a Google Docs URL and returns the validated document ID.
 * Rejects anything that could smuggle path segments or query parameters into API calls.
 */
export function normalizeDocumentId(input: string): string {
  const trimmed = input.trim();
  const candidate = DOCUMENT_URL_PATTERN.exec(trimmed)?.[1] ?? trimmed;
  if (!DOCUMENT_ID_PATTERN.test(candidate)) {
    throw new AppError(
      ErrorCode.INVALID_DOCUMENT_ID,
      'The document ID is not valid. Use the ID from the document URL (https://docs.google.com/document/d/<ID>/edit) or the full URL.',
    );
  }
  return candidate;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new AppError(ErrorCode.INVALID_INDEX, `${name} must be an integer.`);
  }
}

/**
 * Validates an insertion index against the document body. Index 1 is the start of the body;
 * the last valid insertion point is just before the body's final newline (bodyEndIndex - 1).
 */
export function assertInsertIndex(index: number, bodyEndIndex: number): void {
  assertInteger(index, 'index');
  const maxIndex = Math.max(1, bodyEndIndex - 1);
  if (index < 1 || index > maxIndex) {
    throw new AppError(
      ErrorCode.INVALID_INDEX,
      `Index ${index} is outside the document body. Valid insertion indexes are 1 to ${maxIndex}.`,
      { details: { index, minIndex: 1, maxIndex } },
    );
  }
}

export interface RangeOptions {
  /**
   * Whether the range may include the body's final newline (index bodyEndIndex - 1).
   * Styling may include it; deletions may not, because Google Docs forbids deleting it.
   */
  allowFinalNewline: boolean;
}

/** Validates a half-open [startIndex, endIndex) range against the document body. */
export function assertRange(
  startIndex: number,
  endIndex: number,
  bodyEndIndex: number,
  options: RangeOptions,
): void {
  assertInteger(startIndex, 'startIndex');
  assertInteger(endIndex, 'endIndex');
  const maxEnd = options.allowFinalNewline ? bodyEndIndex : bodyEndIndex - 1;
  if (startIndex < 1) {
    throw new AppError(ErrorCode.INVALID_INDEX, 'startIndex must be >= 1.', {
      details: { startIndex, endIndex },
    });
  }
  if (endIndex <= startIndex) {
    throw new AppError(ErrorCode.INVALID_INDEX, 'endIndex must be greater than startIndex.', {
      details: { startIndex, endIndex },
    });
  }
  if (endIndex > maxEnd) {
    throw new AppError(
      ErrorCode.INVALID_INDEX,
      `endIndex ${endIndex} is beyond the end of the document body. The maximum endIndex for this operation is ${maxEnd}.`,
      { details: { startIndex, endIndex, maxEndIndex: maxEnd } },
    );
  }
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#RRGGBB` / `#RGB` into the 0..1 floats used by the Google Docs API. */
export function parseHexColor(value: string): RgbColor {
  const match = HEX_COLOR_PATTERN.exec(value.trim());
  const hex = match?.[1];
  if (!hex) {
    throw new AppError(
      ErrorCode.INVALID_ARGUMENT,
      `Invalid color "${value.slice(0, 20)}". Use a hex color such as #1A73E8.`,
    );
  }
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex;
  const channel = (offset: number) => parseInt(full.slice(offset, offset + 2), 16) / 255;
  return { red: channel(0), green: channel(2), blue: channel(4) };
}

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Only http(s) and mailto links are allowed (no javascript:, data:, file:, ...). */
export function assertSafeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, 'The URL is not valid.');
  }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) {
    throw new AppError(
      ErrorCode.INVALID_ARGUMENT,
      'Only http, https and mailto links are supported.',
    );
  }
  return url.toString();
}

/** Escapes a value for use inside a single-quoted Google Drive query string literal. */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
