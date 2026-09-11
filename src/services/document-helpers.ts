import type { DocsClient } from '../google/docs-client.js';

export interface DocumentBounds {
  documentId: string;
  title: string;
  revisionId: string | undefined;
  /** End index of the body; valid insertion indexes are 1..bodyEndIndex-1. */
  bodyEndIndex: number;
}

/**
 * Fetches only what is needed to validate indexes before a write (a partial response, so it is
 * cheap even for large documents). Pass `revisionId` to `batchUpdate` as `targetRevisionId`.
 */
export async function fetchDocumentBounds(
  docs: DocsClient,
  documentId: string,
): Promise<DocumentBounds> {
  const document = await docs.getDocument(
    documentId,
    'documentId,title,revisionId,body.content(endIndex)',
  );
  return {
    documentId: document.documentId ?? documentId,
    title: document.title ?? '',
    revisionId: document.revisionId ?? undefined,
    bodyEndIndex: document.body?.content?.at(-1)?.endIndex ?? 1,
  };
}
