import { z } from 'zod';
import { documentIdSchema, endIndexSchema, startIndexSchema } from '../../schemas/common.js';
import { ALIGNMENTS, NAMED_STYLE_TYPES } from '../../services/formatting-service.js';
import type { Services } from '../../services/index.js';
import type { RegisterTool } from '../define-tool.js';

const colorSchema = z.string().min(1).max(20);

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerFormattingTools(register: RegisterTool, { formatting }: Services): void {
  register({
    name: 'format_text',
    title: 'Format text in Google Doc',
    description:
      'Apply character formatting to the text in the index range [startIndex, endIndex) of a Google Doc (endIndex is exclusive): bold, italic, underline, strikethrough, fontSize (points), fontFamily (e.g. "Arial", "Roboto") and foregroundColor/backgroundColor (hex such as #1A73E8). Only the properties you pass are changed; all other formatting is kept. Pass false to remove bold, italic, underline or strikethrough. At least one property is required. Get indexes from get_document or find_text (append_text and insert_text also return the range of the new text). Does not change text or indexes.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      startIndex: startIndexSchema,
      endIndex: endIndexSchema,
      bold: z.boolean().optional().describe('true = bold, false = remove bold.'),
      italic: z.boolean().optional().describe('true = italic, false = remove italic.'),
      underline: z.boolean().optional().describe('true = underline, false = remove underline.'),
      strikethrough: z
        .boolean()
        .optional()
        .describe('true = strikethrough, false = remove strikethrough.'),
      fontSize: z.number().min(1).max(400).optional().describe('Font size in points (1-400).'),
      fontFamily: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe('Font family name as shown in Google Docs, e.g. "Arial" or "Roboto".'),
      foregroundColor: colorSchema.optional().describe('Text color as hex, e.g. "#1A73E8".'),
      backgroundColor: colorSchema
        .optional()
        .describe('Highlight (background) color as hex, e.g. "#FFFF00".'),
    }),
    annotations,
    handler: async ({ documentId, startIndex, endIndex, ...style }) =>
      formatting.formatText(documentId, { startIndex, endIndex }, style),
  });

  register({
    name: 'set_paragraph_style',
    title: 'Set paragraph style in Google Doc',
    description:
      'Set the named paragraph style — NORMAL_TEXT, TITLE, SUBTITLE or HEADING_1 to HEADING_6 — of every paragraph that overlaps the index range [startIndex, endIndex). Whole paragraphs are restyled even if the range covers only part of one, so a range inside a single line changes just that line’s paragraph. Use it to turn a line into a heading or back into normal text. Get paragraph startIndex/endIndex from get_document’s structure outline or find_text. Does not change text or indexes.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      startIndex: startIndexSchema,
      endIndex: endIndexSchema,
      style: z
        .enum(NAMED_STYLE_TYPES)
        .describe('Named paragraph style, e.g. HEADING_1 for a top-level heading.'),
    }),
    annotations,
    handler: async ({ documentId, startIndex, endIndex, style }) =>
      formatting.setParagraphStyle(documentId, { startIndex, endIndex }, style),
  });

  register({
    name: 'set_alignment',
    title: 'Set paragraph alignment in Google Doc',
    description:
      'Set the horizontal alignment of every paragraph that overlaps the index range [startIndex, endIndex): START (left in left-to-right text), CENTER, END (right in left-to-right text) or JUSTIFIED. Whole paragraphs are aligned even if the range covers only part of one. Get paragraph indexes from get_document’s structure outline or find_text. Does not change text or indexes.',
    inputSchema: z.strictObject({
      documentId: documentIdSchema,
      startIndex: startIndexSchema,
      endIndex: endIndexSchema,
      alignment: z.enum(ALIGNMENTS).describe('Paragraph alignment.'),
    }),
    annotations,
    handler: async ({ documentId, startIndex, endIndex, alignment }) =>
      formatting.setAlignment(documentId, { startIndex, endIndex }, alignment),
  });
}
