import { z } from 'zod';
import { documentIdSchema } from '../../schemas/common.js';
import type { Services } from '../../services/index.js';
import { DEFAULT_MAX_TEXT_LENGTH } from '../../services/documents-service.js';
import type { RegisterTool } from '../define-tool.js';

const titleSchema = z.string().min(1).max(500);

export function registerDocumentTools(register: RegisterTool, { documents }: Services): void {
  register({
    name: 'create_document',
    title: 'Create Google Doc',
    description:
      'Create a new Google Docs document with the given title in the user’s Google Drive, optionally filled with initial plain text. Returns the new documentId, title and URL. Headings, bold text and lists are not created from the text: apply them afterwards with set_paragraph_style, format_text or create_bulleted_list (use find_text or get_document for the indexes). To add more content later use append_text.',
    inputSchema: z.strictObject({
      title: titleSchema.describe('Title of the new document, e.g. "FYP Proposal".'),
      initialContent: z
        .string()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe(
          'Optional plain text to put in the new document. Use "\\n" to separate paragraphs.',
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ title, initialContent }) => documents.create(title, initialContent),
  });

  register({
    name: 'get_document',
    title: 'Read Google Doc',
    description:
      'Read a Google Doc: returns its title, URL, plain-text content and (by default) a structure outline listing every top-level paragraph and table with exact startIndex/endIndex, heading style and alignment. Also returns bodyEndIndex (valid insertion indexes are 1..bodyEndIndex-1). Use this before index-based edits such as insert_text, delete_text or format_text. Long documents are truncated to maxTextLength characters.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      includeStructure: z
        .boolean()
        .default(true)
        .describe(
          'Include the paragraph/table outline with indexes (needed for index-based edits).',
        ),
      maxTextLength: z
        .number()
        .int()
        .min(100)
        .max(500_000)
        .default(DEFAULT_MAX_TEXT_LENGTH)
        .describe('Maximum number of characters of document text to return.'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async ({ documentId, includeStructure, maxTextLength }) =>
      documents.get(documentId, { includeStructure, maxTextLength }),
  });

  register({
    name: 'list_documents',
    title: 'List Google Docs',
    description:
      'List Google Docs the user can access in Google Drive, most recently modified first. Optionally filter by text contained in the document name (`search`). Returns documentId, name, URL, createdTime and modifiedTime, plus nextPageToken for pagination. To search inside document content use search_documents.',
    inputSchema: z.strictObject({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Maximum number of documents to return (1-100).'),
      pageToken: z
        .string()
        .min(1)
        .max(4096)
        .optional()
        .describe('nextPageToken from a previous list_documents call, to get the next page.'),
      search: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe(
          'Only include documents whose name matches this text (case-insensitive; Drive matches words starting with it).',
        ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async ({ limit, pageToken, search }) => documents.list({ limit, pageToken, search }),
  });

  register({
    name: 'delete_document',
    title: 'Move Google Doc to trash',
    description:
      'Delete a Google Doc by moving it to the user’s Google Drive trash. It is NOT permanently deleted and can be restored from the Drive trash for 30 days. Only Google Docs files are accepted. Only call this when the user clearly asked to delete this specific document; if it is ambiguous which document is meant, ask the user first.',
    inputSchema: z.strictObject({ documentId: documentIdSchema }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async ({ documentId }) => documents.trash(documentId),
  });

  register({
    name: 'copy_document',
    title: 'Copy Google Doc',
    description:
      'Create a copy of an existing Google Doc with a new title (content and formatting are copied). Returns the new document’s ID and URL. Useful for templates or making a backup before large edits.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      newTitle: titleSchema.describe('Title for the copy.'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, newTitle }) => documents.copy(documentId, newTitle),
  });
}
