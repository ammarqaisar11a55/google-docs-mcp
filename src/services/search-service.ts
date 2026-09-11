import type { DocsClient } from '../google/docs-client.js';
import { parseDocument, type ParsedParagraph } from '../google/document-parser.js';
import type { DriveClient, ListFilesParams } from '../google/drive-client.js';
import type { DocumentPage, DocumentReference } from '../types/documents.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { documentUrl } from '../utils/url.js';
import { normalizeDocumentId } from '../utils/validation.js';
import { buildDocumentQuery, DOCUMENT_LIST_FIELDS, toDocumentSummary } from './drive-documents.js';

export const SEARCH_SCOPES = ['name', 'content', 'both'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const DEFAULT_FIND_MAX_RESULTS = 50;
/** Characters of surrounding paragraph text shown on each side of a match. */
const CONTEXT_RADIUS = 40;

const SEARCH_NOTES: Record<SearchScope, string> = {
  name: 'Matched against the document name (case-insensitive; Drive matches words that start with the query, so a fragment from the middle of a word may not match); sorted by most recently modified.',
  content:
    'Matched with the Google Drive full-text index (word/prefix based, not exact substring; also matches document names; very recent edits may not be indexed yet). Sorted by relevance.',
  both: 'Matched by document name (word prefix) OR the Google Drive full-text index (word/prefix based, not exact substring; very recent edits may not be indexed yet). Sorted by relevance.',
};

export interface SearchDocumentsOptions {
  query: string;
  limit: number;
  searchIn: SearchScope;
  pageToken?: string | undefined;
}

export interface SearchDocumentsResult extends DocumentPage {
  query: string;
  searchIn: SearchScope;
  note: string;
}

export interface FindTextOptions {
  matchCase?: boolean;
  maxResults?: number;
}

export interface TextOccurrence {
  /** Document index of the first matched character (inclusive). */
  startIndex: number;
  /** Document index just after the last matched character (exclusive). */
  endIndex: number;
  matchedText: string;
  paragraphStyle: string | null;
  inTable: boolean;
  /** A short snippet of the surrounding paragraph text. */
  context: string;
}

export interface FindTextResult extends DocumentReference {
  text: string;
  matchCase: boolean;
  occurrences: TextOccurrence[];
  totalMatches: number;
  /** True when more matches exist than were returned (see maxResults). */
  truncated: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildContext(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_RADIUS);
  const to = Math.min(text.length, end + CONTEXT_RADIUS);
  const snippet = text.slice(from, to).replace(/[\n\v\r]/g, ' ');
  return `${from > 0 ? '…' : ''}${snippet}${to < text.length ? '…' : ''}`;
}

/** Search across Google Drive and within a single document. */
export class SearchService {
  constructor(
    private readonly docs: DocsClient,
    private readonly drive: DriveClient,
  ) {}

  async searchDocuments(options: SearchDocumentsOptions): Promise<SearchDocumentsResult> {
    const query = options.query.trim();
    if (query === '') {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, 'The search query must not be empty.');
    }
    const params: ListFilesParams = {
      q: buildDocumentQuery({
        nameContains: options.searchIn === 'content' ? undefined : query,
        fullTextContains: options.searchIn === 'name' ? undefined : query,
      }),
      pageSize: options.limit,
      pageToken: options.pageToken,
      fields: DOCUMENT_LIST_FIELDS,
    };
    // Drive rejects orderBy combined with fullText queries; those results are relevance-ordered.
    if (options.searchIn === 'name') params.orderBy = 'modifiedTime desc';

    const { files, nextPageToken } = await this.drive.listFiles(params);
    const documents = files.map(toDocumentSummary);
    return {
      query,
      searchIn: options.searchIn,
      documents,
      count: documents.length,
      nextPageToken: nextPageToken ?? null,
      note: SEARCH_NOTES[options.searchIn],
    };
  }

  async findText(
    documentIdOrUrl: string,
    text: string,
    options: FindTextOptions = {},
  ): Promise<FindTextResult> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    if (text === '') {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, 'The text to find must not be empty.');
    }
    const matchCase = options.matchCase ?? false;
    const maxResults = options.maxResults ?? DEFAULT_FIND_MAX_RESULTS;
    const parsed = parseDocument(await this.docs.getDocument(documentId));

    // A RegExp (instead of lowercasing both strings) keeps match offsets exact: case mapping can
    // change string length (e.g. "İ".toLowerCase() has two UTF-16 code units).
    const pattern = new RegExp(escapeRegExp(text), matchCase ? 'g' : 'gi');
    const occurrences: TextOccurrence[] = [];
    let totalMatches = 0;
    for (const paragraph of parsed.paragraphs) {
      totalMatches += this.collectMatches(paragraph, pattern, occurrences, maxResults);
    }

    return {
      documentId: parsed.documentId,
      title: parsed.title,
      url: documentUrl(parsed.documentId),
      text,
      matchCase,
      occurrences,
      totalMatches,
      truncated: totalMatches > occurrences.length,
    };
  }

  /** Adds matches in one paragraph to `occurrences` (up to `limit`); returns the match count. */
  private collectMatches(
    paragraph: ParsedParagraph,
    pattern: RegExp,
    occurrences: TextOccurrence[],
    limit: number,
  ): number {
    // Matches never include the paragraph's terminating newline.
    const content = paragraph.text.endsWith('\n') ? paragraph.text.slice(0, -1) : paragraph.text;
    let count = 0;
    for (const match of content.matchAll(pattern)) {
      count += 1;
      if (occurrences.length >= limit) continue;
      const start = match.index;
      const end = start + match[0].length;
      occurrences.push({
        startIndex: paragraph.startIndex + start,
        endIndex: paragraph.startIndex + end,
        matchedText: match[0],
        paragraphStyle: paragraph.namedStyleType ?? null,
        inTable: paragraph.inTable,
        context: buildContext(content, start, end),
      });
    }
    return count;
  }
}
