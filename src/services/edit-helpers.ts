import type { DocsBatchUpdateResponse, DocsClient, DocsRequest } from '../google/docs-client.js';
import { OBJECT_PLACEHOLDER, type ParsedParagraph } from '../google/document-parser.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { normalizeDocumentId } from '../utils/validation.js';
import { type DocumentBounds, fetchDocumentBounds } from './document-helpers.js';

/** A half-open [startIndex, endIndex) range of document indexes. */
export interface IndexRange {
  startIndex: number;
  endIndex: number;
}

/** Normalizes a document ID or URL, then fetches the bounds needed to validate indexes. */
export async function loadDocumentBounds(
  docs: DocsClient,
  documentIdOrUrl: string,
): Promise<DocumentBounds> {
  return fetchDocumentBounds(docs, normalizeDocumentId(documentIdOrUrl));
}

/**
 * Sends requests whose indexes were computed against `target`, pinned to that revision so Google
 * transforms them over any collaborator edits made in the meantime.
 */
export function batchUpdateAt(
  docs: DocsClient,
  target: Pick<DocumentBounds, 'documentId' | 'revisionId'>,
  requests: DocsRequest[],
): Promise<DocsBatchUpdateResponse> {
  return docs.batchUpdate(target.documentId, requests, { targetRevisionId: target.revisionId });
}

/**
 * Characters Google Docs strips from inserted text: U+0000-U+0008, U+000C-U+001F and the Basic
 * Multilingual Plane Private Use Area (U+E000-U+F8FF). Tab, newline and U+000B are kept.
 */
function isUnsupportedCharCode(code: number): boolean {
  return code <= 0x08 || (code >= 0x0c && code <= 0x1f) || (code >= 0xe000 && code <= 0xf8ff);
}

/**
 * Prepares text for `insertText`: CRLF/CR become "\n" (a paragraph break) and characters Google
 * Docs would silently drop are removed up front, so `result.length` is exactly the number of
 * indexes the insertion occupies.
 */
export function sanitizeInsertText(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  let sanitized = '';
  let chunkStart = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (isUnsupportedCharCode(normalized.charCodeAt(i))) {
      sanitized += normalized.slice(chunkStart, i);
      chunkStart = i + 1;
    }
  }
  sanitized += normalized.slice(chunkStart);
  if (sanitized.length === 0) {
    throw new AppError(
      ErrorCode.INVALID_ARGUMENT,
      'The text is empty after removing control characters that Google Docs cannot store.',
    );
  }
  return sanitized;
}

/**
 * Returns the text currently stored in [startIndex, endIndex), built from parsed paragraphs
 * (including paragraphs in table cells). Structural markers such as table/row/cell boundaries
 * have no text and are skipped; inline objects appear as {@link OBJECT_PLACEHOLDER}.
 */
export function extractRangeText(
  paragraphs: readonly ParsedParagraph[],
  range: IndexRange,
): string {
  let text = '';
  for (const paragraph of paragraphs) {
    if (paragraph.endIndex <= range.startIndex || paragraph.startIndex >= range.endIndex) continue;
    const from = Math.max(range.startIndex, paragraph.startIndex) - paragraph.startIndex;
    const to = Math.min(range.endIndex, paragraph.endIndex) - paragraph.startIndex;
    text += paragraph.text.slice(from, to);
  }
  return text;
}

/** Compares document text with caller-supplied text, ignoring inline-object placeholders. */
export function matchesExpectedText(actual: string, expected: string): boolean {
  const strip = (value: string) => value.replaceAll(OBJECT_PLACEHOLDER, '');
  return strip(actual) === strip(expected);
}

/** Shortens text for inclusion in messages. */
export function previewText(text: string, maxLength = 120): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
