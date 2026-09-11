import { z } from 'zod';
import { documentIdSchema } from '../../schemas/common.js';
import type { Services } from '../../services/index.js';
import { DEFAULT_FIND_MAX_RESULTS, SEARCH_SCOPES } from '../../services/search-service.js';
import type { RegisterTool } from '../define-tool.js';

export function registerSearchTools(register: RegisterTool, { search }: Services): void {
  register({
    name: 'search_documents',
    title: 'Search Google Docs',
    description: `Search the user’s Google Drive for Google Docs by name and/or content. Only Google Docs the user can access and that are not in the trash are returned (other file types are never included).
- searchIn "name": case-insensitive match on the document name. Drive matches words that start with the query ("Prop" finds "FYP Proposal"), so a fragment from the middle of a word may not match. Results sorted by most recently modified.
- searchIn "content": Google Drive full-text search of document content. It is word/prefix based (not exact substring or phrase matching), also matches document names, and may lag behind very recent edits because Drive indexes content asynchronously. Results are ordered by relevance.
- searchIn "both" (default): name OR full-text match, ordered by relevance.
Returns documentId, name, URL, createdTime and modifiedTime for each match, plus nextPageToken for pagination. To locate text inside one specific document use find_text; to list recent documents use list_documents.`,
    inputSchema: z.strictObject({
      query: z
        .string()
        .min(1)
        .max(500)
        .describe('Text to search for, e.g. "FYP" or "quarterly report".'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Maximum number of documents to return (1-100).'),
      searchIn: z
        .enum(SEARCH_SCOPES)
        .default('both')
        .describe(
          'Where to search: "name" (words in the document name starting with the query), "content" (Drive full-text index) or "both".',
        ),
      pageToken: z
        .string()
        .min(1)
        .max(4096)
        .optional()
        .describe(
          'nextPageToken from a previous search_documents call with the same query and searchIn, to get the next page.',
        ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async ({ query, limit, searchIn, pageToken }) =>
      search.searchDocuments({ query, limit, searchIn, pageToken }),
  });

  register({
    name: 'find_text',
    title: 'Find text in a Google Doc',
    description:
      'Find every occurrence of a literal phrase in a Google Doc (including text inside table cells) and return the exact startIndex/endIndex of each match, its paragraph style, whether it is in a table, and a short context snippet. Use this to get exact indexes for index-based tools such as format_text, delete_text, insert_link or insert_text. Matching is literal (no wildcards or regular expressions), case-insensitive unless matchCase is true, and a match cannot span paragraphs or include the paragraph’s line break. Indexes are only valid until the document is edited: when applying several edits, work from the last occurrence backwards.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      text: z.string().min(1).max(1000).describe('The exact text to find.'),
      matchCase: z
        .boolean()
        .default(false)
        .describe('Match upper/lower case exactly (default: case-insensitive).'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(DEFAULT_FIND_MAX_RESULTS)
        .describe(
          'Maximum number of occurrences to return (1-500). totalMatches always reports the full count.',
        ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async ({ documentId, text, matchCase, maxResults }) =>
      search.findText(documentId, text, { matchCase, maxResults }),
  });
}
