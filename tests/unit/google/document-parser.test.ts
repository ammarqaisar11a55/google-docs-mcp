import { describe, expect, it } from 'vitest';
import type { GoogleDocument } from '../../../src/google/docs-client.js';
import {
  OBJECT_PLACEHOLDER,
  parseDocument,
  type ParsedParagraph,
  type ParsedTable,
} from '../../../src/google/document-parser.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';
import { DOC_ID, makeDocument } from '../../helpers/fakes.js';

/** Returns the document index of `needle` using the paragraph index mapping. */
function indexOf(paragraphs: ParsedParagraph[], needle: string): number {
  for (const paragraph of paragraphs) {
    const offset = paragraph.text.indexOf(needle);
    if (offset >= 0) return paragraph.startIndex + offset;
  }
  return -1;
}

describe('parseDocument', () => {
  it('maps paragraphs to exact start/end indexes and text', () => {
    const parsed = parseDocument(makeDocument(['Hello', 'World'], { title: 'Greeting' }));
    expect(parsed.documentId).toBe(DOC_ID);
    expect(parsed.title).toBe('Greeting');
    expect(parsed.revisionId).toBe('rev-1');
    expect(parsed.paragraphs).toEqual([
      {
        type: 'paragraph',
        startIndex: 1,
        endIndex: 7,
        text: 'Hello\n',
        namedStyleType: 'NORMAL_TEXT',
        alignment: undefined,
        isListItem: false,
        inTable: false,
      },
      expect.objectContaining({ startIndex: 7, endIndex: 13, text: 'World\n' }),
    ]);
    expect(parsed.bodyEndIndex).toBe(13);
    expect(parsed.text).toBe('Hello\nWorld\n');
    expect(parsed.blocks.map((block) => block.type)).toEqual([
      'sectionBreak',
      'paragraph',
      'paragraph',
    ]);
  });

  it('keeps paragraph text length equal to its index span', () => {
    const parsed = parseDocument(makeDocument(['First line', { heading: 'Title' }, 'Last']));
    for (const paragraph of parsed.paragraphs) {
      expect(paragraph.text.length).toBe(paragraph.endIndex - paragraph.startIndex);
    }
    expect(indexOf(parsed.paragraphs, 'Title')).toBe(12);
    expect(indexOf(parsed.paragraphs, 'Last')).toBe(18);
  });

  it('reports headings, alignment and list items', () => {
    const document = makeDocument([
      { heading: 'Intro' },
      { heading: 'Details', style: 'HEADING_2' },
      { bullet: 'Point' },
      'Body',
    ]);
    const body = document.body!.content!;
    body[4]!.paragraph!.paragraphStyle = { namedStyleType: 'NORMAL_TEXT', alignment: 'CENTER' };
    const parsed = parseDocument(document);
    expect(parsed.paragraphs.map((p) => p.namedStyleType)).toEqual([
      'HEADING_1',
      'HEADING_2',
      'NORMAL_TEXT',
      'NORMAL_TEXT',
    ]);
    expect(parsed.paragraphs.map((p) => p.isListItem)).toEqual([false, false, true, false]);
    expect(parsed.paragraphs[3]!.alignment).toBe('CENTER');
    expect(parsed.paragraphs[0]!.alignment).toBeUndefined();
  });

  it('parses tables with cell text and in-table paragraphs', () => {
    const parsed = parseDocument(
      makeDocument([
        'Before',
        {
          table: [
            ['a', 'b'],
            ['c', 'd'],
          ],
        },
        'After',
      ]),
    );
    const table = parsed.blocks.find((block): block is ParsedTable => block.type === 'table');
    expect(table).toMatchObject({
      rows: 2,
      columns: 2,
      cells: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    });
    expect(table!.startIndex).toBe(8);

    const cellParagraphs = parsed.paragraphs.filter((p) => p.inTable);
    expect(cellParagraphs.map((p) => p.text)).toEqual(['a\n', 'b\n', 'c\n', 'd\n']);
    for (const paragraph of cellParagraphs) {
      expect(paragraph.startIndex).toBeGreaterThan(table!.startIndex);
      expect(paragraph.endIndex).toBeLessThan(table!.endIndex);
    }
    // Paragraph order follows the document (body, cells, body).
    expect(parsed.paragraphs.map((p) => p.text)).toEqual([
      'Before\n',
      'a\n',
      'b\n',
      'c\n',
      'd\n',
      'After\n',
    ]);
    expect(parsed.paragraphs.at(-1)!.startIndex).toBe(table!.endIndex);
    expect(parsed.text).toBe('Before\na | b\nc | d\nAfter\n');
  });

  it('uses U+FFFC placeholders for inline objects but strips them from text', () => {
    const document: GoogleDocument = {
      documentId: DOC_ID,
      title: 'Images',
      body: {
        content: [
          { startIndex: 0, endIndex: 1, sectionBreak: {} },
          {
            startIndex: 1,
            endIndex: 12,
            paragraph: {
              elements: [
                { startIndex: 1, endIndex: 4, textRun: { content: 'Hi ' } },
                { startIndex: 4, endIndex: 5, inlineObjectElement: { inlineObjectId: 'img-1' } },
                { startIndex: 5, endIndex: 12, textRun: { content: ' there\n' } },
              ],
            },
          },
        ],
      },
    };
    const parsed = parseDocument(document);
    expect(OBJECT_PLACEHOLDER).toBe('￼');
    expect(parsed.paragraphs[0]!.text).toBe('Hi ￼ there\n');
    expect(parsed.paragraphs[0]!.text.length).toBe(11);
    expect(indexOf(parsed.paragraphs, 'there')).toBe(6);
    expect(parsed.text).toBe('Hi  there\n');
    expect(parsed.text).not.toContain(OBJECT_PLACEHOLDER);
  });

  it('counts indexes in UTF-16 code units', () => {
    const document = makeDocument(['😀 ok', 'next']);
    const parsed = parseDocument(document);
    expect(parsed.paragraphs[0]!.endIndex).toBe(1 + '😀 ok\n'.length);
    expect(parsed.paragraphs[0]!.endIndex).toBe(7);
    expect(indexOf(parsed.paragraphs, 'next')).toBe(7);
  });

  it('reports table-of-contents blocks', () => {
    const document: GoogleDocument = {
      documentId: DOC_ID,
      body: {
        content: [
          { startIndex: 0, endIndex: 1, sectionBreak: {} },
          { startIndex: 1, endIndex: 20, tableOfContents: { content: [] } },
          {
            startIndex: 20,
            endIndex: 22,
            paragraph: {
              elements: [{ startIndex: 20, endIndex: 22, textRun: { content: 'x\n' } }],
            },
          },
        ],
      },
    };
    const parsed = parseDocument(document);
    expect(parsed.blocks[1]).toEqual({ type: 'tableOfContents', startIndex: 1, endIndex: 20 });
    expect(parsed.text).toBe('x\n');
    expect(parsed.bodyEndIndex).toBe(22);
  });

  it('computes bodyEndIndex for an empty document', () => {
    const parsed = parseDocument(makeDocument());
    expect(parsed.bodyEndIndex).toBe(2);
    expect(parsed.text).toBe('\n');
    expect(parsed.paragraphs).toHaveLength(1);
  });

  it('handles a document without a body or title', () => {
    const parsed = parseDocument({ documentId: DOC_ID });
    expect(parsed).toMatchObject({
      title: '',
      revisionId: undefined,
      bodyEndIndex: 1,
      blocks: [],
      paragraphs: [],
      text: '',
    });
  });

  it('throws when Google returns a document without an ID', () => {
    let caught: unknown;
    try {
      parseDocument({ title: 'No ID' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCode.GOOGLE_API_ERROR);
  });
});
