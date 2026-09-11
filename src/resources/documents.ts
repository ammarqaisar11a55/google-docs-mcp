import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { Services } from '../services/index.js';
import { toAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const DOCUMENT_RESOURCE_TEMPLATE = 'google-docs://document/{documentId}';
const RESOURCE_MIME_TYPE = 'text/plain';
/** How many recently modified documents `resources/list` advertises. */
export const RESOURCE_LIST_LIMIT = 25;
/** Resources return the whole document for all but extremely long documents. */
export const RESOURCE_MAX_TEXT_LENGTH = 200_000;

export function documentResourceUri(documentId: string): string {
  return `google-docs://document/${documentId}`;
}

/**
 * Exposes Google Docs as `google-docs://document/{documentId}` resources, so clients can attach a
 * document's current plain text as context without a tool call.
 */
export function registerDocumentResources(server: McpServer, { documents }: Services): void {
  const template = new ResourceTemplate(DOCUMENT_RESOURCE_TEMPLATE, {
    list: async () => {
      try {
        const page = await documents.list({ limit: RESOURCE_LIST_LIMIT });
        return {
          resources: page.documents.map((doc) => ({
            uri: documentResourceUri(doc.documentId),
            name: doc.name || doc.documentId,
            title: doc.name || doc.documentId,
            mimeType: RESOURCE_MIME_TYPE,
            ...(doc.modifiedTime
              ? { description: `Google Doc, last modified ${doc.modifiedTime}.` }
              : {}),
          })),
        };
      } catch (err) {
        // Listing is a convenience (e.g. not signed in yet): never fail the whole resources/list.
        logger.debug('Could not list Google Docs resources.', { code: toAppError(err).code });
        return { resources: [] };
      }
    },
  });

  server.registerResource(
    'google-doc',
    template,
    {
      title: 'Google Doc',
      description:
        'The current plain-text content of a Google Doc (title first, tables rendered as "a | b" rows). Read-only; use the get_document tool when exact indexes for editing are needed.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri, variables) => {
      const raw = variables.documentId;
      const documentId = (Array.isArray(raw) ? raw[0] : raw) ?? '';
      try {
        // documents.get validates the ID (normalizeDocumentId) before any Google call.
        const doc = await documents.get(documentId, {
          includeStructure: false,
          maxTextLength: RESOURCE_MAX_TEXT_LENGTH,
        });
        const notice = doc.textTruncated
          ? `\n\n[Truncated: showing the first ${RESOURCE_MAX_TEXT_LENGTH} of ${doc.textLength} characters. Use the get_document tool with a larger maxTextLength for the rest.]`
          : '';
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: RESOURCE_MIME_TYPE,
              text: `${doc.title}\n\n${doc.text}${notice}`,
            },
          ],
        };
      } catch (err) {
        const appError = toAppError(err);
        logger.warn('Reading Google Doc resource failed.', {
          code: appError.code,
          cause: appError.cause,
        });
        // The SDK sends only `message` (plus numeric `code` / `data`, absent here) to the client, so
        // just the safe message crosses the protocol boundary; `cause` stays server-side.
        throw new Error(appError.message, { cause: err });
      }
    },
  );
}
