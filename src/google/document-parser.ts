import type { docs_v1 } from '@googleapis/docs';
import { AppError, ErrorCode } from '../utils/errors.js';
import type { GoogleDocument } from './docs-client.js';

type StructuralElement = docs_v1.Schema$StructuralElement;
type Paragraph = docs_v1.Schema$Paragraph;

/** Stands in for non-text paragraph elements (images, page breaks, chips, ...), one per index. */
export const OBJECT_PLACEHOLDER = '￼';

export interface ParsedParagraph {
  type: 'paragraph';
  startIndex: number;
  endIndex: number;
  /**
   * Paragraph text including its trailing newline. Character `i` is located at document index
   * `startIndex + i` (Google Docs indexes are UTF-16 code units, like JavaScript strings).
   */
  text: string;
  namedStyleType: string | undefined;
  alignment: string | undefined;
  isListItem: boolean;
  inTable: boolean;
}

export interface ParsedTable {
  type: 'table';
  startIndex: number;
  endIndex: number;
  rows: number;
  columns: number;
  cells: string[][];
}

export interface ParsedMarker {
  type: 'sectionBreak' | 'tableOfContents';
  startIndex: number;
  endIndex: number;
}

export type ParsedBlock = ParsedParagraph | ParsedTable | ParsedMarker;

export interface ParsedDocument {
  documentId: string;
  title: string;
  revisionId: string | undefined;
  /** End index of the body. Valid insertion indexes are 1..bodyEndIndex-1. */
  bodyEndIndex: number;
  /** Top-level body blocks in document order. */
  blocks: ParsedBlock[];
  /** Every paragraph in document order, including paragraphs inside table cells. */
  paragraphs: ParsedParagraph[];
  /** Readable plain-text rendering of the body (tables as `a | b` rows, objects removed). */
  text: string;
}

function paragraphText(paragraph: Paragraph): string {
  let text = '';
  for (const element of paragraph.elements ?? []) {
    const content = element.textRun?.content;
    if (typeof content === 'string') {
      text += content;
    } else {
      const length = Math.max(0, (element.endIndex ?? 0) - (element.startIndex ?? 0));
      text += OBJECT_PLACEHOLDER.repeat(length);
    }
  }
  return text;
}

function blocksToText(blocks: ParsedBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'paragraph') return block.text.replaceAll(OBJECT_PLACEHOLDER, '');
      if (block.type === 'table')
        return `${block.cells.map((row) => row.join(' | ')).join('\n')}\n`;
      return '';
    })
    .join('');
}

function parseContent(
  content: StructuralElement[] | undefined,
  inTable: boolean,
  paragraphs: ParsedParagraph[],
): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  for (const element of content ?? []) {
    const startIndex = element.startIndex ?? 0;
    const endIndex = element.endIndex ?? startIndex;

    if (element.paragraph) {
      const style = element.paragraph.paragraphStyle;
      const paragraph: ParsedParagraph = {
        type: 'paragraph',
        startIndex,
        endIndex,
        text: paragraphText(element.paragraph),
        namedStyleType: style?.namedStyleType ?? undefined,
        alignment: style?.alignment ?? undefined,
        isListItem: Boolean(element.paragraph.bullet),
        inTable,
      };
      paragraphs.push(paragraph);
      blocks.push(paragraph);
    } else if (element.table) {
      const cells = (element.table.tableRows ?? []).map((row) =>
        (row.tableCells ?? []).map((cell) =>
          blocksToText(parseContent(cell.content, true, paragraphs)).trim(),
        ),
      );
      blocks.push({
        type: 'table',
        startIndex,
        endIndex,
        rows: element.table.rows ?? cells.length,
        columns: element.table.columns ?? cells[0]?.length ?? 0,
        cells,
      });
    } else if (element.tableOfContents) {
      blocks.push({ type: 'tableOfContents', startIndex, endIndex });
    } else if (element.sectionBreak) {
      blocks.push({ type: 'sectionBreak', startIndex, endIndex });
    }
  }
  return blocks;
}

/** Converts a raw Google Docs API document into a compact, index-accurate representation. */
export function parseDocument(document: GoogleDocument): ParsedDocument {
  if (!document.documentId) {
    throw new AppError(ErrorCode.GOOGLE_API_ERROR, 'Google returned a document without an ID.');
  }
  const paragraphs: ParsedParagraph[] = [];
  const blocks = parseContent(document.body?.content ?? undefined, false, paragraphs);
  return {
    documentId: document.documentId,
    title: document.title ?? '',
    revisionId: document.revisionId ?? undefined,
    bodyEndIndex: document.body?.content?.at(-1)?.endIndex ?? 1,
    blocks,
    paragraphs,
    text: blocksToText(blocks),
  };
}
