import type { GetPromptResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/*
 * Prompts only produce instructions for the client's AI. They never call Google or an AI model:
 * the AI follows the steps using this server's tools.
 */

const documentIdArg = z
  .string()
  .min(1)
  .max(500)
  .describe('The Google Docs document ID or full document URL.');

const INDEX_RULES = `Index rules:
- Indexes are UTF-16 offsets; the body starts at index 1. Get exact indexes from get_document (structure) or find_text — never guess them.
- Every insertion or deletion shifts all indexes after it. Apply index-based edits from the end of the document backwards (highest startIndex first), or call get_document again before each further edit.
- Never delete the document's final newline.`;

function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

function optionalSection(label: string, value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? `\n${label}:\n${trimmed}\n` : '';
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'summarize_document',
    {
      title: 'Summarize a Google Doc',
      description:
        'Read a Google Doc and summarize it in the chat (the document is not modified). Optionally focus on a specific aspect.',
      argsSchema: z.object({
        documentId: documentIdArg,
        focus: z
          .string()
          .max(1000)
          .optional()
          .describe('Optional aspect to focus on, e.g. "action items" or "budget".'),
      }),
    },
    ({ documentId, focus }) =>
      userMessage(`Summarize the Google Doc with documentId "${documentId}".
${optionalSection('Focus especially on', focus)}
Steps:
1. Call get_document with this documentId and includeStructure=false. If the result has textTruncated=true, call it again with a larger maxTextLength (up to 500000) so the summary covers the whole document.
2. Write a concise summary: one or two sentences on the document's purpose, then the key points as bullets, then any decisions, action items, deadlines and open questions it contains.
3. Base the summary only on the document's content; do not invent details.
4. Do not modify the document. Reply in the chat with the summary, and include the document title and URL.`),
  );

  server.registerPrompt(
    'rewrite_document',
    {
      title: 'Rewrite a Google Doc',
      description:
        'Rewrite or edit a Google Doc in place according to instructions, preserving everything the instructions do not ask to change.',
      argsSchema: z.object({
        documentId: documentIdArg,
        instructions: z
          .string()
          .min(1)
          .max(5000)
          .describe(
            'What to change, e.g. "make the tone more formal" or "shorten the introduction".',
          ),
      }),
    },
    ({ documentId, instructions }) =>
      userMessage(`Rewrite the Google Doc with documentId "${documentId}" according to these instructions:

<instructions>
${instructions.trim()}
</instructions>

Steps:
1. Call get_document with this documentId (includeStructure=true) to read the current text and the paragraph/table outline with exact startIndex/endIndex. If textTruncated is true, call it again with a larger maxTextLength.
2. Plan the minimal set of changes. Preserve all content the instructions do not ask you to change: keep its wording, headings, lists, tables, links and formatting exactly as they are.
3. If the rewrite is extensive, offer to make a backup first with copy_document.
4. Apply the changes:
   - For a phrase that should be replaced everywhere, use replace_text.
   - To rewrite a specific passage, get its exact range from the structure outline or find_text, then delete_text that range and insert_text the new wording at the same startIndex.
   - To add new content at the end, use append_text.
   - Restore formatting on rewritten passages where needed with format_text and set_paragraph_style.
5. Call get_document again to verify the result, then summarize for the user what changed.

${INDEX_RULES}`),
  );

  server.registerPrompt(
    'format_document',
    {
      title: 'Format a Google Doc',
      description:
        'Improve the formatting of a Google Doc (headings, lists, emphasis, alignment) without changing its wording. Optionally follow a style guide.',
      argsSchema: z.object({
        documentId: documentIdArg,
        styleGuide: z
          .string()
          .max(5000)
          .optional()
          .describe('Optional formatting rules, e.g. "Headings in HEADING_2, key terms in bold".'),
      }),
    },
    ({ documentId, styleGuide }) =>
      userMessage(`Improve the formatting of the Google Doc with documentId "${documentId}".
${
  styleGuide?.trim()
    ? optionalSection('Follow this style guide', styleGuide)
    : `
No style guide was given. Use a clean, consistent style: one TITLE, a clear heading hierarchy (HEADING_1 for sections, HEADING_2 for subsections), bulleted lists for enumerations, bold only for a few key terms, and consistent alignment.
`
}
Steps:
1. Call get_document with this documentId (includeStructure=true) to get every paragraph with its startIndex/endIndex, current style and alignment.
2. Plan the formatting. Only change formatting: do not add, remove or reword text unless the style guide explicitly requires it, and leave paragraphs that already match the style unchanged.
3. Apply the formatting:
   - set_paragraph_style for titles and headings (named styles such as TITLE, HEADING_1, HEADING_2, NORMAL_TEXT).
   - set_alignment for paragraph alignment.
   - create_bulleted_list for paragraphs that form a list.
   - find_text to get the exact range of a phrase, then format_text for bold, italic, underline, colour or font size.
   - insert_link to turn text into a hyperlink.
4. Call get_document again to verify, then summarize the changes for the user.

${INDEX_RULES}`),
  );

  server.registerPrompt(
    'create_meeting_notes',
    {
      title: 'Create meeting notes',
      description:
        'Create a new, well-structured Google Doc with meeting notes (details, attendees, discussion, decisions, action items) from the provided information.',
      argsSchema: z.object({
        title: z.string().min(1).max(500).describe('Meeting title, e.g. "Sprint Planning".'),
        date: z
          .string()
          .max(100)
          .optional()
          .describe('Meeting date, e.g. "2026-09-11". Defaults to today.'),
        attendees: z
          .string()
          .max(5000)
          .optional()
          .describe('Attendees, comma- or newline-separated.'),
        notes: z
          .string()
          .max(50_000)
          .optional()
          .describe('Raw notes, agenda or transcript excerpts to organise.'),
      }),
    },
    ({ title, date, attendees, notes }) =>
      userMessage(`Create meeting notes in a new Google Doc.

Meeting title: ${title.trim()}
Date: ${date?.trim() || "today's date"}
${optionalSection('Attendees', attendees)}${optionalSection('Raw notes', notes)}
Steps:
1. Call create_document with the title "${title.trim()} — <date>" (use the date above).
2. Organise the content into these sections: Meeting details (date and attendees), Agenda / Discussion, Decisions, Action items (each with owner and due date), Next steps. Use only the information provided; do not invent decisions, owners or dates — write "TBD" where something is unknown, and omit sections with nothing to say.
3. Add the content with append_text, one line per paragraph (a single call with the whole text is fine).
4. Call get_document (includeStructure=true) to get exact paragraph indexes, then:
   - set_paragraph_style: TITLE for the first line and HEADING_1 for each section heading.
   - create_bulleted_list for attendees, discussion points and action items.
   - Optionally format_text (bold) for action-item owners.
5. Reply with the document URL and a short summary of the notes.

${INDEX_RULES}`),
  );
}
