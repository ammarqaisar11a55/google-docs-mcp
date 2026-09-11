import { z } from 'zod';
import {
  documentIdSchema,
  endIndexSchema,
  indexSchema,
  startIndexSchema,
} from '../../schemas/common.js';
import type { Services } from '../../services/index.js';
import type { RegisterTool } from '../define-tool.js';

const MAX_TEXT_LENGTH = 1_000_000;

const textSchema = z.string().min(1).max(MAX_TEXT_LENGTH);

export function registerContentTools(register: RegisterTool, { content }: Services): void {
  register({
    name: 'append_text',
    title: 'Append text to Google Doc',
    description:
      'Append text to the end of a Google Doc’s body. No indexes are needed, so prefer this over insert_text whenever content should go at the end. By default the text starts in a new paragraph (a paragraph break is added first if the last paragraph is not empty); set startNewParagraph=false to continue the last paragraph instead. Use "\\n" inside text to create further paragraphs. Returns insertedLength and the index range of the appended text (textStartIndex/textEndIndex), which can be passed to format_text or set_paragraph_style. Carriage returns become "\\n" and control characters Google Docs cannot store are removed.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      text: textSchema.describe('The text to append. "\\n" starts a new paragraph.'),
      startNewParagraph: z
        .boolean()
        .default(true)
        .describe(
          'Start the text in a new paragraph when the last paragraph is not empty (default true). Set false to continue the last paragraph.',
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, text, startNewParagraph }) =>
      content.append(documentId, text, { startNewParagraph }),
  });

  register({
    name: 'insert_text',
    title: 'Insert text into Google Doc',
    description:
      'Insert text at a specific index of a Google Doc. Get the index from get_document (the structure outline’s startIndex/endIndex) or find_text; the body starts at index 1 and the largest valid index is bodyEndIndex-1. To insert at the start of a paragraph use its startIndex. The inserted text takes the style of the neighbouring text, and "\\n" creates new paragraphs. Inserting shifts every later index by insertedLength, so when making several index-based edits work from the end of the document backwards or re-read it with get_document. To add text at the end use append_text; to change existing wording use replace_text.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      index: indexSchema,
      text: textSchema.describe('The text to insert. "\\n" starts a new paragraph.'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, index, text }) => content.insert(documentId, index, text),
  });

  register({
    name: 'replace_text',
    title: 'Replace text in Google Doc',
    description:
      'Replace ALL occurrences of searchText throughout the entire Google Doc with replacementText, in one operation. An empty replacementText DELETES every occurrence. Matching is plain text (no regular expressions) and case-insensitive unless matchCase is true, so a short search such as "an" may also match inside other words. If the search text is short or could match more than intended, preview the matches with find_text first, and use insert_text/delete_text for a single occurrence. Returns occurrencesChanged (0 means nothing matched and the document is unchanged). Indexes after each changed occurrence shift when the lengths differ. No index is needed.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      searchText: z
        .string()
        .min(1)
        .max(MAX_TEXT_LENGTH)
        .describe('The exact text to search for (not a regular expression).'),
      replacementText: z
        .string()
        .max(MAX_TEXT_LENGTH)
        .describe('Text that replaces every match. An empty string deletes every match.'),
      matchCase: z
        .boolean()
        .default(false)
        .describe('Only replace matches with exactly the same upper/lower case (default false).'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, searchText, replacementText, matchCase }) =>
      content.replace(documentId, searchText, replacementText, matchCase),
  });

  register({
    name: 'delete_text',
    title: 'Delete text from Google Doc',
    description:
      'DESTRUCTIVE: delete the content in the index range [startIndex, endIndex) of a Google Doc (endIndex is exclusive). Get the indexes from get_document or find_text immediately before calling. Strongly recommended: pass expectedText with the exact text currently in that range (including any "\\n" paragraph breaks); if it does not match, nothing is deleted and the current text is returned, which protects against stale indexes. The document’s final newline cannot be deleted (the maximum endIndex is bodyEndIndex-1). Deleting a paragraph break merges the two paragraphs; tables can only be deleted as a whole, although the text inside a cell can be deleted. Every later index shifts back by deletedLength. Deleted content can only be recovered from the Google Docs version history. To delete every occurrence of a phrase use replace_text with an empty replacementText.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      startIndex: startIndexSchema,
      endIndex: endIndexSchema,
      expectedText: z
        .string()
        .min(1)
        .max(MAX_TEXT_LENGTH)
        .optional()
        .describe(
          'The exact text currently in [startIndex, endIndex). If given, the deletion is refused when the document text differs.',
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ documentId, startIndex, endIndex, expectedText }) =>
      content.delete(documentId, { startIndex, endIndex }, expectedText),
  });
}
