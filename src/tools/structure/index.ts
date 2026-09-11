import { z } from 'zod';
import {
  documentIdSchema,
  endIndexSchema,
  indexSchema,
  startIndexSchema,
} from '../../schemas/common.js';
import type { Services } from '../../services/index.js';
import { LIST_TYPES } from '../../services/structure-service.js';
import type { RegisterTool } from '../define-tool.js';

export function registerStructureTools(register: RegisterTool, { structure }: Services): void {
  register({
    name: 'insert_page_break',
    title: 'Insert page break into Google Doc',
    description:
      'Insert a page break at an index of a Google Doc, so the content after it starts on a new page. The index must be inside an existing body paragraph (not inside a table, header, footer or footnote); to break before a paragraph use its startIndex from get_document or find_text. Inserting shifts every later index, so re-read the document with get_document before further index-based edits.',
    inputSchema: z.strictObject({ documentId: documentIdSchema, index: indexSchema }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, index }) => structure.insertPageBreak(documentId, index),
  });

  register({
    name: 'insert_table',
    title: 'Insert table into Google Doc',
    description:
      'Insert an empty table with the given number of rows and columns at an index of a Google Doc. Google inserts a paragraph break before the table, so the table starts at index + 1 (returned as tableStartIndex). The index must be inside an existing paragraph — not at a table’s start and not inside a footnote; to add a table at the end use bodyEndIndex-1 from get_document. Every cell starts with an empty paragraph: call get_document afterwards to get exact cell indexes, then fill cells with insert_text starting from the LAST cell so earlier indexes stay valid. Inserting shifts every later index.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      index: indexSchema,
      rows: z.number().int().min(1).max(100).describe('Number of rows (1-100).'),
      columns: z.number().int().min(1).max(20).describe('Number of columns (1-20).'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, index, rows, columns }) =>
      structure.insertTable(documentId, index, rows, columns),
  });

  register({
    name: 'insert_link',
    title: 'Insert hyperlink in Google Doc',
    description:
      'Turn the existing text in the index range [startIndex, endIndex) of a Google Doc into a hyperlink to url (http, https and mailto links only). The text itself is not changed and any link already on it is replaced. To link new text, first add it with insert_text or append_text (both return the new text’s range), then link that range. Get indexes from get_document or find_text. Does not change indexes.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      startIndex: startIndexSchema,
      endIndex: endIndexSchema,
      url: z
        .string()
        .min(1)
        .max(2048)
        .describe('Link target, e.g. "https://example.com" or "mailto:someone@example.com".'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async ({ documentId, startIndex, endIndex, url }) =>
      structure.insertLink(documentId, { startIndex, endIndex }, url),
  });

  register({
    name: 'create_bulleted_list',
    title: 'Create list in Google Doc',
    description:
      'Turn every paragraph that overlaps the index range [startIndex, endIndex) of a Google Doc into a list item: listType "bulleted" (default), "numbered" (1., a., i.) or "checkbox". Consecutive paragraphs become one list; to build a list from new content, append or insert the items as separate lines ("\\n"-separated) first, then call this with their range. Leading tab characters in the paragraphs are converted into nesting levels and removed, which shifts later indexes; otherwise indexes are unchanged. Get paragraph indexes from get_document’s structure outline.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      startIndex: startIndexSchema,
      endIndex: endIndexSchema,
      listType: z
        .enum(LIST_TYPES)
        .default('bulleted')
        .describe('bulleted (•), numbered (1. 2. 3.) or checkbox (☐). Default: bulleted.'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async ({ documentId, startIndex, endIndex, listType }) =>
      structure.createList(documentId, { startIndex, endIndex }, listType),
  });
}
