import type { DriveFile } from '../google/drive-client.js';
import type { DocumentSummary } from '../types/documents.js';
import { documentUrl } from '../utils/url.js';
import { escapeDriveQueryValue } from '../utils/validation.js';

export const GOOGLE_DOCS_MIME_TYPE = 'application/vnd.google-apps.document';
export const DOCUMENT_FILE_FIELDS = 'id,name,mimeType,createdTime,modifiedTime,webViewLink,trashed';
export const DOCUMENT_LIST_FIELDS = `nextPageToken,files(${DOCUMENT_FILE_FIELDS})`;

export interface DocumentQueryOptions {
  /** Match documents whose file name contains this text (case-insensitive, Drive semantics). */
  nameContains?: string | undefined;
  /** Match documents whose indexed content or name contains this text (Drive full-text search). */
  fullTextContains?: string | undefined;
}

/**
 * Builds a Drive `q` string restricted to non-trashed Google Docs. All user input is escaped,
 * so it cannot break out of the string literal and alter the query.
 */
export function buildDocumentQuery(options: DocumentQueryOptions = {}): string {
  const clauses = [`mimeType='${GOOGLE_DOCS_MIME_TYPE}'`, 'trashed=false'];
  const terms: string[] = [];
  if (options.nameContains) {
    terms.push(`name contains '${escapeDriveQueryValue(options.nameContains)}'`);
  }
  if (options.fullTextContains) {
    terms.push(`fullText contains '${escapeDriveQueryValue(options.fullTextContains)}'`);
  }
  if (terms.length > 0) clauses.push(`(${terms.join(' or ')})`);
  return clauses.join(' and ');
}

export function toDocumentSummary(file: DriveFile): DocumentSummary {
  const documentId = file.id ?? '';
  return {
    documentId,
    name: file.name ?? '',
    url: documentUrl(documentId),
    createdTime: file.createdTime ?? null,
    modifiedTime: file.modifiedTime ?? null,
  };
}
