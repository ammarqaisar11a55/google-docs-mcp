import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../../src/utils/errors.js';
import { createTestDependencies, DOC_ID, makeDocument } from '../../helpers/fakes.js';
import { connectTestClient, expectError, expectSuccess } from '../../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/edit`;
const AT_REVISION = { targetRevisionId: 'rev-1' };
const RANGE = { startIndex: 1, endIndex: 6 };

describe('structure tools', () => {
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

  describe('insert_page_break', () => {
    it('inserts a page break at a validated index', async () => {
      const data = expectSuccess(
        await h.callTool('insert_page_break', { documentId: DOC_ID, index: 6 }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertPageBreak: { location: { index: 6 } } }],
        AT_REVISION,
      );
      expect(data).toEqual({ documentId: DOC_ID, url: DOC_URL, index: 6 });
    });

    it('rejects an index outside the body with INVALID_INDEX', async () => {
      const error = expectError(
        await h.callTool('insert_page_break', { documentId: DOC_ID, index: 13 }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('maps a 400 from Google (e.g. inside a table) to INVALID_REQUEST', async () => {
      t.docs.batchUpdate.mockRejectedValue({
        status: 400,
        response: {
          status: 400,
          data: {
            error: {
              message:
                'Invalid requests[0].insertPageBreak: Page breaks cannot be inserted inside a table.',
            },
          },
        },
      });
      const error = expectError(
        await h.callTool('insert_page_break', { documentId: DOC_ID, index: 3 }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_REQUEST);
      expect(error.message).toContain('cannot be inserted inside a table');
    });
  });

  describe('insert_table', () => {
    it('inserts a table and reports where it starts', async () => {
      const data = expectSuccess(
        await h.callTool('insert_table', { documentId: DOC_ID, index: 12, rows: 3, columns: 2 }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertTable: { rows: 3, columns: 2, location: { index: 12 } } }],
        AT_REVISION,
      );
      expect(data).toEqual({
        documentId: DOC_ID,
        url: DOC_URL,
        index: 12,
        tableStartIndex: 13,
        rows: 3,
        columns: 2,
      });
    });

    it.each([
      { rows: 0, columns: 2 },
      { rows: 101, columns: 2 },
      { rows: 2, columns: 0 },
      { rows: 2, columns: 21 },
      { rows: 1.5, columns: 2 },
    ])('rejects invalid dimensions %o at the schema level', async (dimensions) => {
      const outcome = await h.callTool('insert_table', {
        documentId: DOC_ID,
        index: 1,
        ...dimensions,
      });
      expect(outcome.isError).toBe(true);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });

    it('rejects an index outside the body with INVALID_INDEX', async () => {
      const error = expectError(
        await h.callTool('insert_table', { documentId: DOC_ID, index: 99, rows: 1, columns: 1 }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('maps a 403 from Google to PERMISSION_DENIED', async () => {
      t.docs.batchUpdate.mockRejectedValue({
        status: 403,
        message: 'The caller does not have permission',
      });
      const error = expectError(
        await h.callTool('insert_table', { documentId: DOC_ID, index: 1, rows: 2, columns: 2 }),
      );
      expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
    });
  });

  describe('insert_link', () => {
    it('links the range with a link-only field mask', async () => {
      const data = expectSuccess(
        await h.callTool('insert_link', {
          documentId: DOC_ID,
          ...RANGE,
          url: 'https://example.com',
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [
          {
            updateTextStyle: {
              range: RANGE,
              textStyle: { link: { url: 'https://example.com/' } },
              fields: 'link',
            },
          },
        ],
        AT_REVISION,
      );
      expect(data).toEqual({
        documentId: DOC_ID,
        url: DOC_URL,
        ...RANGE,
        linkUrl: 'https://example.com/',
      });
    });

    it('accepts mailto links', async () => {
      expectSuccess(
        await h.callTool('insert_link', {
          documentId: DOC_ID,
          ...RANGE,
          url: 'mailto:someone@example.com',
        }),
      );
      const requests = t.docs.batchUpdate.mock.calls[0]?.[1];
      expect(requests?.[0]?.updateTextStyle?.textStyle?.link?.url).toBe(
        'mailto:someone@example.com',
      );
    });

    it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'not a url'])(
      'rejects unsafe or invalid URL %s without calling Google',
      async (url) => {
        const error = expectError(
          await h.callTool('insert_link', { documentId: DOC_ID, ...RANGE, url }),
        );
        expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
        expect(t.docs.getDocument).not.toHaveBeenCalled();
        expect(t.docs.batchUpdate).not.toHaveBeenCalled();
      },
    );

    it('does not allow the range to include the final newline', async () => {
      const error = expectError(
        await h.callTool('insert_link', {
          documentId: DOC_ID,
          startIndex: 1,
          endIndex: 13,
          url: 'https://example.com',
        }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('create_bulleted_list', () => {
    it.each([
      ['bulleted', 'BULLET_DISC_CIRCLE_SQUARE'],
      ['numbered', 'NUMBERED_DECIMAL_ALPHA_ROMAN'],
      ['checkbox', 'BULLET_CHECKBOX'],
    ])('creates a %s list with preset %s', async (listType, bulletPreset) => {
      const data = expectSuccess(
        await h.callTool('create_bulleted_list', { documentId: DOC_ID, ...RANGE, listType }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ createParagraphBullets: { range: RANGE, bulletPreset } }],
        AT_REVISION,
      );
      expect(data).toEqual({ documentId: DOC_ID, url: DOC_URL, ...RANGE, listType, bulletPreset });
    });

    it('defaults to a bulleted list', async () => {
      const data = expectSuccess(
        await h.callTool('create_bulleted_list', {
          documentId: DOC_ID,
          startIndex: 1,
          endIndex: 13,
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [
          {
            createParagraphBullets: {
              range: { startIndex: 1, endIndex: 13 },
              bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
            },
          },
        ],
        AT_REVISION,
      );
      expect(data).toMatchObject({ listType: 'bulleted' });
    });

    it('rejects unknown list types at the schema level', async () => {
      const outcome = await h.callTool('create_bulleted_list', {
        documentId: DOC_ID,
        ...RANGE,
        listType: 'roman',
      });
      expect(outcome.isError).toBe(true);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });
  });
});
