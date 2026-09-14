import type { DocsClient } from '../google/docs-client.js';
import { parseDocument, type ParsedBlock } from '../google/document-parser.js';
import type { DriveClient, DriveFile } from '../google/drive-client.js';
import type { DocumentPage, DocumentReference } from '../types/documents.js';
import { AppError, ErrorCode, toAppError } from '../utils/errors.js';
import { documentUrl } from '../utils/url.js';
import { normalizeDocumentId } from '../utils/validation.js';
import { sanitizeInsertText } from './edit-helpers.js';
import {
  buildDocumentQuery,
  DOCUMENT_FILE_FIELDS,
  DOCUMENT_LIST_FIELDS,
  GOOGLE_DOCS_MIME_TYPE,
  toDocumentSummary,
} from './drive-documents.js';

export const DEFAULT_MAX_TEXT_LENGTH = 20_000;
export const MAX_STRUCTURE_ITEMS = 500;
const PARAGRAPH_PREVIEW_LENGTH = 200;

export type StructureItem =
  | {
      type: 'paragraph';
      startIndex: number;
      endIndex: number;
      style: string | null;
      alignment: string | null;
      listItem: boolean;
      text: string;
      textTruncated: boolean;
    }
  | { type: 'table'; startIndex: number; endIndex: number; rows: number; columns: number }
  | { type: 'tableOfContents'; startIndex: number; endIndex: number };

export interface DocumentContent extends DocumentReference {
  revisionId: string | null;
  /** Valid insertion indexes are 1..bodyEndIndex-1. */
  bodyEndIndex: number;
  text: string;
  textLength: number;
  textTruncated: boolean;
  structure?: StructureItem[];
  structureTruncated?: boolean;
}

export interface GetDocumentOptions {
  maxTextLength?: number;
  includeStructure?: boolean;
}

export interface ListDocumentsOptions {
  limit: number;
  pageToken?: string | undefined;
  search?: string | undefined;
}

function toStructureItem(block: ParsedBlock): StructureItem | undefined {
  switch (block.type) {
    case 'paragraph': {
      const text = block.text.replace(/\n$/, '');
      return {
        type: 'paragraph',
        startIndex: block.startIndex,
        endIndex: block.endIndex,
        style: block.namedStyleType ?? null,
        alignment: block.alignment ?? null,
        listItem: block.isListItem,
        text: text.slice(0, PARAGRAPH_PREVIEW_LENGTH),
        textTruncated: text.length > PARAGRAPH_PREVIEW_LENGTH,
      };
    }
    case 'table':
      return {
        type: 'table',
        startIndex: block.startIndex,
        endIndex: block.endIndex,
        rows: block.rows,
        columns: block.columns,
      };
    case 'tableOfContents':
      return { type: 'tableOfContents', startIndex: block.startIndex, endIndex: block.endIndex };
    case 'sectionBreak':
      return undefined;
  }
}

/** Document-level operations: create, read, list, copy and trash Google Docs. */
export class DocumentsService {
  constructor(
    private readonly docs: DocsClient,
    private readonly drive: DriveClient,
  ) {}

  /**
   * Creates a document, optionally with initial plain-text content. The content is validated
   * before anything is created, so invalid content never leaves an empty document behind.
   */
  async create(
    title: string,
    initialContent?: string,
  ): Promise<DocumentReference & { insertedLength?: number }> {
    const content = initialContent === undefined ? undefined : sanitizeInsertText(initialContent);
    const document = await this.docs.createDocument(title);
    if (!document.documentId) {
      throw new AppError(ErrorCode.GOOGLE_API_ERROR, 'Google did not return a document ID.');
    }
    const reference: DocumentReference = {
      documentId: document.documentId,
      title: document.title ?? title,
      url: documentUrl(document.documentId),
    };
    if (content === undefined) return reference;

    try {
      // A new document's body is a single empty paragraph, so index 1 is its start.
      await this.docs.batchUpdate(
        reference.documentId,
        [{ insertText: { text: content, location: { index: 1 } } }],
        { targetRevisionId: document.revisionId ?? undefined },
      );
    } catch (err) {
      const cause = toAppError(err);
      throw new AppError(
        cause.code,
        `The document was created, but adding the initial content failed: ${cause.message} The empty document is at ${reference.url}; add the content with append_text.`,
        { details: { ...reference }, cause: err },
      );
    }
    return { ...reference, insertedLength: content.length };
  }

  async get(documentIdOrUrl: string, options: GetDocumentOptions = {}): Promise<DocumentContent> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const parsed = parseDocument(await this.docs.getDocument(documentId));
    const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    const result: DocumentContent = {
      documentId: parsed.documentId,
      title: parsed.title,
      url: documentUrl(parsed.documentId),
      revisionId: parsed.revisionId ?? null,
      bodyEndIndex: parsed.bodyEndIndex,
      text: parsed.text.slice(0, maxTextLength),
      textLength: parsed.text.length,
      textTruncated: parsed.text.length > maxTextLength,
    };
    if (options.includeStructure ?? true) {
      const items = parsed.blocks
        .map(toStructureItem)
        .filter((item): item is StructureItem => item !== undefined);
      result.structure = items.slice(0, MAX_STRUCTURE_ITEMS);
      result.structureTruncated = items.length > MAX_STRUCTURE_ITEMS;
    }
    return result;
  }

  async list(options: ListDocumentsOptions): Promise<DocumentPage> {
    const { files, nextPageToken } = await this.drive.listFiles({
      q: buildDocumentQuery({ nameContains: options.search }),
      pageSize: options.limit,
      pageToken: options.pageToken,
      orderBy: 'modifiedTime desc',
      fields: DOCUMENT_LIST_FIELDS,
    });
    const documents = files.map(toDocumentSummary);
    return { documents, count: documents.length, nextPageToken: nextPageToken ?? null };
  }

  /** Moves a Google Doc to the Drive trash. Refuses to touch files that are not Google Docs. */
  async trash(
    documentIdOrUrl: string,
  ): Promise<DocumentReference & { trashed: true; message: string }> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    const file = await this.requireGoogleDoc(documentId);
    if (!file.trashed) await this.drive.trashFile(documentId, DOCUMENT_FILE_FIELDS);
    return {
      documentId,
      title: file.name ?? '',
      url: documentUrl(documentId),
      trashed: true,
      message: file.trashed
        ? 'The document was already in the Google Drive trash.'
        : 'The document was moved to the Google Drive trash. It can be restored from the trash (Drive keeps trashed files for 30 days).',
    };
  }

  async copy(
    documentIdOrUrl: string,
    newTitle: string,
  ): Promise<DocumentReference & { sourceDocumentId: string }> {
    const documentId = normalizeDocumentId(documentIdOrUrl);
    await this.requireGoogleDoc(documentId);
    const copy = await this.drive.copyFile(documentId, newTitle, DOCUMENT_FILE_FIELDS);
    if (!copy.id) {
      throw new AppError(ErrorCode.GOOGLE_API_ERROR, 'Google did not return the ID of the copy.');
    }
    return {
      documentId: copy.id,
      title: copy.name ?? newTitle,
      url: documentUrl(copy.id),
      sourceDocumentId: documentId,
    };
  }

  private async requireGoogleDoc(documentId: string): Promise<DriveFile> {
    const file = await this.drive.getFile(documentId, DOCUMENT_FILE_FIELDS);
    if (file.mimeType !== GOOGLE_DOCS_MIME_TYPE) {
      throw new AppError(
        ErrorCode.INVALID_ARGUMENT,
        'The file is not a Google Docs document, so this server will not modify it.',
      );
    }
    return file;
  }
}
