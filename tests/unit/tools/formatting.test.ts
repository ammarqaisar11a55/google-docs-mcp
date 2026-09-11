import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALIGNMENTS } from '../../../src/services/formatting-service.js';
import { ErrorCode } from '../../../src/utils/errors.js';
import { createTestDependencies, DOC_ID, makeDocument } from '../../helpers/fakes.js';
import { connectTestClient, expectError, expectSuccess } from '../../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/edit`;
const AT_REVISION = { targetRevisionId: 'rev-1' };
const RANGE = { startIndex: 1, endIndex: 6 };

describe('formatting tools', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;

  beforeEach(async () => {
    t = createTestDependencies();
    // "Hello world\n" occupies [1, 13); bodyEndIndex is 13.
    t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
  });

  describe('format_text', () => {
    it.each([
      ['bold', { bold: true }],
      ['italic', { italic: true }],
      ['underline', { underline: true }],
      ['strikethrough', { strikethrough: true }],
    ])('applies only %s', async (field, style) => {
      const data = expectSuccess(
        await h.callTool('format_text', { documentId: DOC_ID, ...RANGE, ...style }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ updateTextStyle: { range: RANGE, textStyle: style, fields: field } }],
        AT_REVISION,
      );
      expect(data).toEqual({ documentId: DOC_ID, url: DOC_URL, ...RANGE, updatedFields: [field] });
    });

    it('combines styles and sends false values to remove formatting', async () => {
      expectSuccess(
        await h.callTool('format_text', {
          documentId: DOC_ID,
          ...RANGE,
          bold: true,
          italic: false,
          underline: true,
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [
          {
            updateTextStyle: {
              range: RANGE,
              textStyle: { bold: true, italic: false, underline: true },
              fields: 'bold,italic,underline',
            },
          },
        ],
        AT_REVISION,
      );
    });

    it('converts font size, font family and hex colors to the Docs API shapes', async () => {
      const data = expectSuccess(
        await h.callTool('format_text', {
          documentId: DOC_ID,
          ...RANGE,
          fontSize: 14,
          fontFamily: 'Roboto',
          foregroundColor: '#FF0000',
          backgroundColor: '#0f0',
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [
          {
            updateTextStyle: {
              range: RANGE,
              textStyle: {
                fontSize: { magnitude: 14, unit: 'PT' },
                weightedFontFamily: { fontFamily: 'Roboto' },
                foregroundColor: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } },
                backgroundColor: { color: { rgbColor: { red: 0, green: 1, blue: 0 } } },
              },
              fields: 'fontSize,weightedFontFamily,foregroundColor,backgroundColor',
            },
          },
        ],
        AT_REVISION,
      );
      expect(data).toMatchObject({
        updatedFields: ['fontSize', 'weightedFontFamily', 'foregroundColor', 'backgroundColor'],
      });
    });

    it('lists every specified field in the mask in a stable order', async () => {
      expectSuccess(
        await h.callTool('format_text', {
          documentId: DOC_ID,
          ...RANGE,
          backgroundColor: '#FFFF00',
          fontFamily: 'Arial',
          strikethrough: false,
          fontSize: 11.5,
          underline: false,
          foregroundColor: '#1A73E8',
          italic: true,
          bold: true,
        }),
      );
      const requests = t.docs.batchUpdate.mock.calls[0]?.[1];
      expect(requests?.[0]?.updateTextStyle?.fields).toBe(
        'bold,italic,underline,strikethrough,fontSize,weightedFontFamily,foregroundColor,backgroundColor',
      );
      expect(requests?.[0]?.updateTextStyle?.textStyle?.fontSize).toEqual({
        magnitude: 11.5,
        unit: 'PT',
      });
    });

    it('allows the range to include the final newline', async () => {
      expectSuccess(
        await h.callTool('format_text', {
          documentId: DOC_ID,
          startIndex: 1,
          endIndex: 13,
          bold: true,
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects a range beyond the body with INVALID_INDEX', async () => {
      const error = expectError(
        await h.callTool('format_text', {
          documentId: DOC_ID,
          startIndex: 1,
          endIndex: 14,
          bold: true,
        }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('requires at least one style property (INVALID_ARGUMENT, no Google calls)', async () => {
      const error = expectError(await h.callTool('format_text', { documentId: DOC_ID, ...RANGE }));
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('rejects an invalid color with INVALID_ARGUMENT', async () => {
      const error = expectError(
        await h.callTool('format_text', { documentId: DOC_ID, ...RANGE, foregroundColor: 'red' }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range font size at the schema level', async () => {
      const outcome = await h.callTool('format_text', {
        documentId: DOC_ID,
        ...RANGE,
        fontSize: 0,
      });
      expect(outcome.isError).toBe(true);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('set_paragraph_style', () => {
    it.each(['TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_6', 'NORMAL_TEXT'])(
      'sets %s with a namedStyleType field mask',
      async (style) => {
        const data = expectSuccess(
          await h.callTool('set_paragraph_style', { documentId: DOC_ID, ...RANGE, style }),
        );
        expect(t.docs.batchUpdate).toHaveBeenCalledWith(
          DOC_ID,
          [
            {
              updateParagraphStyle: {
                range: RANGE,
                paragraphStyle: { namedStyleType: style },
                fields: 'namedStyleType',
              },
            },
          ],
          AT_REVISION,
        );
        expect(data).toEqual({ documentId: DOC_ID, url: DOC_URL, ...RANGE, style });
      },
    );

    it('rejects unknown styles at the schema level', async () => {
      const outcome = await h.callTool('set_paragraph_style', {
        documentId: DOC_ID,
        ...RANGE,
        style: 'HEADING_7',
      });
      expect(outcome.isError).toBe(true);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('rejects endIndex <= startIndex with INVALID_INDEX', async () => {
      const error = expectError(
        await h.callTool('set_paragraph_style', {
          documentId: DOC_ID,
          startIndex: 6,
          endIndex: 3,
          style: 'HEADING_1',
        }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('set_alignment', () => {
    it.each(ALIGNMENTS)('sets %s alignment with an alignment field mask', async (alignment) => {
      const data = expectSuccess(
        await h.callTool('set_alignment', { documentId: DOC_ID, ...RANGE, alignment }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [
          {
            updateParagraphStyle: {
              range: RANGE,
              paragraphStyle: { alignment },
              fields: 'alignment',
            },
          },
        ],
        AT_REVISION,
      );
      expect(data).toEqual({ documentId: DOC_ID, url: DOC_URL, ...RANGE, alignment });
    });

    it('rejects unsupported alignments at the schema level', async () => {
      const outcome = await h.callTool('set_alignment', {
        documentId: DOC_ID,
        ...RANGE,
        alignment: 'LEFT',
      });
      expect(outcome.isError).toBe(true);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('maps a missing document to DOCUMENT_NOT_FOUND', async () => {
      t.docs.getDocument.mockRejectedValue({
        status: 404,
        message: 'Requested entity was not found.',
      });
      const error = expectError(
        await h.callTool('set_alignment', { documentId: DOC_ID, ...RANGE, alignment: 'CENTER' }),
      );
      expect(error.code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    });
  });
});
