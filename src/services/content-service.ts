import type { DocsClient } from '../google/docs-client.js';
import { parseDocument } from '../google/document-parser.js';
import type { WriteResult } from '../types/documents.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { documentUrl } from '../utils/url.js';
import { assertInsertIndex, assertRange, normalizeDocumentId } from '../utils/validation.js';
import { type DocumentBounds, fetchDocumentBounds } from './document-helpers.js';
import {
  batchUpdateAt,
  extractRangeText,
  type IndexRange,
  loadDocumentBounds,
  matchesExpectedText,
  previewText,
  sanitizeInsertText,
} from './edit-helpers.js';

/** Enough to know the revision, the body end and whether the last paragraph is empty. */
const APPEND_FIELDS = 'documentId,revisionId,body.content(startIndex,endIndex)';

export interface AppendTextOptions {
  /** Start the text in a new paragraph when the last paragraph already has content. */
  startNewParagraph: boolean;
}

export interface AppendTextResult extends WriteResult {
  /** Number of indexes inserted, including a leading paragraph break if one was added. */
  insertedLength: number;
  startedNewParagraph: boolean;
  /** Range [textStartIndex, textEndIndex) now occupied by the appended text. */
  textStartIndex: number;
  textEndIndex: number;
  newBodyEndIndex: number;
}

export interface InsertTextResult extends WriteResult {
  index: number;
  insertedLength: number;
  /** Exclusive end of the inserted text. */
  endIndex: number;
  newBodyEndIndex: number;
}

export interface ReplaceTextResult extends WriteResult {
  searchText: string;
  matchCase: boolean;
  occurrencesChanged: number;
  message: string;
}

export interface DeleteTextResult extends WriteResult {
  startIndex: number;
  endIndex: number;
  deletedLength: number;
  newBodyEndIndex: number;
  expectedTextVerified: boolean;
}

/** Text operations: append, insert, replace and delete document content. */
export class ContentService {
  constructor(private readonly docs: DocsClient) {}

  async append(
    documentIdOrUrl: string,
    text: string,
    options: AppendTextOptions,
  ): Promise<AppendTextResult> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const content = sanitizeInsertText(text);
    const document = await this.docs.getDocument(documentId, APPEND_FIELDS);
    const last = document.body?.content?.at(-1);
    const bodyEndIndex = last?.endIndex ?? 1;
    // The body always ends with a paragraph; one spanning a single index holds only its "\n".
    const lastParagraphEmpty = (last?.endIndex ?? 0) - (last?.startIndex ?? 0) <= 1;
    const prefix = options.startNewParagraph && !lastParagraphEmpty ? '\n' : '';
    const inserted = prefix + content;

    const target = {
      documentId: document.documentId ?? documentId,
      revisionId: document.revisionId ?? undefined,
    };
    await batchUpdateAt(this.docs, target, [
      { insertText: { text: inserted, endOfSegmentLocation: {} } },
    ]);

    // endOfSegmentLocation inserts just before the body's final newline.
    const textStartIndex = Math.max(1, bodyEndIndex - 1) + prefix.length;
    return {
      documentId: target.documentId,
      url: documentUrl(target.documentId),
      insertedLength: inserted.length,
      startedNewParagraph: prefix.length > 0,
      textStartIndex,
      textEndIndex: textStartIndex + content.length,
      newBodyEndIndex: Math.max(bodyEndIndex, 2) + inserted.length,
    };
  }

  async insert(documentIdOrUrl: string, index: number, text: string): Promise<InsertTextResult> {
    const content = sanitizeInsertText(text);
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertInsertIndex(index, bounds.bodyEndIndex);
    await batchUpdateAt(this.docs, bounds, [
      { insertText: { text: content, location: { index } } },
    ]);
    return {
      documentId: bounds.documentId,
      url: documentUrl(bounds.documentId),
      index,
      insertedLength: content.length,
      endIndex: index + content.length,
      newBodyEndIndex: bounds.bodyEndIndex + content.length,
    };
  }

  /** Replaces every occurrence of `searchText` in the document (`replaceAllText`). */
  async replace(
    documentIdOrUrl: string,
    searchText: string,
    replacementText: string,
    matchCase: boolean,
  ): Promise<ReplaceTextResult> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const response = await this.docs.batchUpdate(documentId, [
      {
        replaceAllText: {
          containsText: { text: searchText, matchCase },
          replaceText: replacementText,
        },
      },
    ]);
    const occurrencesChanged = response.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
    let message: string;
    if (occurrencesChanged === 0) {
      message = 'No occurrences were found. The document was not changed.';
    } else {
      const noun = occurrencesChanged === 1 ? 'occurrence' : 'occurrences';
      message =
        replacementText === ''
          ? `Deleted ${occurrencesChanged} ${noun}.`
          : `Replaced ${occurrencesChanged} ${noun}.`;
    }
    return {
      documentId,
      url: documentUrl(documentId),
      searchText,
      matchCase,
      occurrencesChanged,
      message,
    };
  }

  /**
   * Deletes [startIndex, endIndex). When `expectedText` is given, the whole document is read and
   * the deletion is refused unless the range currently holds exactly that text.
   */
  async delete(
    documentIdOrUrl: string,
    range: IndexRange,
    expectedText?: string,
  ): Promise<DeleteTextResult> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const { startIndex, endIndex } = range;
    let bounds: DocumentBounds;

    if (expectedText === undefined) {
      bounds = await fetchDocumentBounds(this.docs, documentId);
      assertRange(startIndex, endIndex, bounds.bodyEndIndex, { allowFinalNewline: false });
    } else {
      const parsed = parseDocument(await this.docs.getDocument(documentId));
      bounds = parsed;
      assertRange(startIndex, endIndex, bounds.bodyEndIndex, { allowFinalNewline: false });
      const actualText = extractRangeText(parsed.paragraphs, range);
      if (!matchesExpectedText(actualText, expectedText)) {
        const actualPreview = previewText(actualText);
        throw new AppError(
          ErrorCode.INVALID_ARGUMENT,
          `Nothing was deleted: the text at indexes ${startIndex}-${endIndex} does not match expectedText. The document has probably changed since the indexes were read. Current text in that range: ${JSON.stringify(actualPreview)}. Call get_document or find_text to get fresh indexes.`,
          { details: { startIndex, endIndex, actualText: actualPreview } },
        );
      }
    }

    await batchUpdateAt(this.docs, bounds, [
      { deleteContentRange: { range: { startIndex, endIndex } } },
    ]);
    const deletedLength = endIndex - startIndex;
    return {
      documentId: bounds.documentId,
      url: documentUrl(bounds.documentId),
      startIndex,
      endIndex,
      deletedLength,
      newBodyEndIndex: bounds.bodyEndIndex - deletedLength,
      expectedTextVerified: expectedText !== undefined,
    };
  }
}
