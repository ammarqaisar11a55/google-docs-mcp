import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../../src/utils/errors.js';
import { createTestDependencies, DOC_ID, makeDocument } from '../../helpers/fakes.js';
import { connectTestClient, expectError, expectSuccess } from '../../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/edit`;
const BOUNDS_FIELDS = 'documentId,title,revisionId,body.content(endIndex)';
const APPEND_FIELDS = 'documentId,revisionId,body.content(startIndex,endIndex)';
const AT_REVISION = { targetRevisionId: 'rev-1' };

describe('content tools', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;

  beforeEach(async () => {
    t = createTestDependencies();
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
  });

  it('registers the content tools with safety annotations', async () => {
    const { tools } = await h.client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ['delete_text', 'replace_text']) {
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
    }
    for (const name of ['append_text', 'insert_text']) {
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
    }
    expect(byName.get('replace_text')?.description).toContain('ALL occurrences');
    expect(byName.get('delete_text')?.description).toContain('expectedText');
  });

  describe('append_text', () => {
    it('starts a new paragraph when the last paragraph has text', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const data = expectSuccess(
        await h.callTool('append_text', { documentId: DOC_ID, text: 'More' }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID, APPEND_FIELDS);
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: '\nMore', endOfSegmentLocation: {} } }],
        AT_REVISION,
      );
      expect(data).toEqual({
        documentId: DOC_ID,
        url: DOC_URL,
        insertedLength: 5,
        startedNewParagraph: true,
        textStartIndex: 13,
        textEndIndex: 17,
        newBodyEndIndex: 18,
      });
    });

    it('does not add a paragraph break when the last paragraph is empty', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello', '']));
      const data = expectSuccess(
        await h.callTool('append_text', { documentId: DOC_ID, text: 'World' }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: 'World', endOfSegmentLocation: {} } }],
        AT_REVISION,
      );
      expect(data).toMatchObject({
        insertedLength: 5,
        startedNewParagraph: false,
        textStartIndex: 7,
        textEndIndex: 12,
        newBodyEndIndex: 13,
      });
    });

    it('appends to an empty document without a leading newline', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument());
      const data = expectSuccess(
        await h.callTool('append_text', { documentId: DOC_ID, text: 'First line' }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: 'First line', endOfSegmentLocation: {} } }],
        AT_REVISION,
      );
      expect(data).toMatchObject({ textStartIndex: 1, textEndIndex: 11, newBodyEndIndex: 12 });
    });

    it('continues the last paragraph when startNewParagraph is false', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello']));
      const data = expectSuccess(
        await h.callTool('append_text', {
          documentId: DOC_ID,
          text: ' again',
          startNewParagraph: false,
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: ' again', endOfSegmentLocation: {} } }],
        AT_REVISION,
      );
      expect(data).toMatchObject({ startedNewParagraph: false, textStartIndex: 6 });
    });

    it('normalizes carriage returns and strips characters Google Docs cannot store', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument());
      const text = `a\r\nb${String.fromCharCode(1)}c`;
      const data = expectSuccess(await h.callTool('append_text', { documentId: DOC_ID, text }));
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: 'a\nbc', endOfSegmentLocation: {} } }],
        AT_REVISION,
      );
      expect(data).toMatchObject({ insertedLength: 4 });
    });

    it('rejects empty text without calling Google', async () => {
      const outcome = await h.callTool('append_text', { documentId: DOC_ID, text: '' });
      expect(outcome.isError).toBe(true);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });

    it('rejects text made only of unsupported control characters', async () => {
      const text = String.fromCharCode(0, 1, 2);
      const error = expectError(await h.callTool('append_text', { documentId: DOC_ID, text }));
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });
  });

  describe('insert_text', () => {
    it('inserts at a validated index against the fetched revision', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const data = expectSuccess(
        await h.callTool('insert_text', { documentId: DOC_ID, index: 7, text: 'big ' }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID, BOUNDS_FIELDS);
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: 'big ', location: { index: 7 } } }],
        AT_REVISION,
      );
      expect(data).toEqual({
        documentId: DOC_ID,
        url: DOC_URL,
        index: 7,
        insertedLength: 4,
        endIndex: 11,
        newBodyEndIndex: 17,
      });
    });

    it('accepts the last valid index (bodyEndIndex - 1) and a document URL', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      expectSuccess(await h.callTool('insert_text', { documentId: DOC_URL, index: 12, text: '!' }));
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ insertText: { text: '!', location: { index: 12 } } }],
        AT_REVISION,
      );
    });

    it('rejects an index outside the body with INVALID_INDEX and sends nothing', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const error = expectError(
        await h.callTool('insert_text', { documentId: DOC_ID, index: 13, text: 'x' }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(error.details).toMatchObject({ index: 13, minIndex: 1, maxIndex: 12 });
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('rejects index 0 at the schema level', async () => {
      const outcome = await h.callTool('insert_text', { documentId: DOC_ID, index: 0, text: 'x' });
      expect(outcome.isError).toBe(true);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });
  });

  describe('replace_text', () => {
    it('replaces all occurrences and reports occurrencesChanged', async () => {
      t.docs.batchUpdate.mockResolvedValue({
        replies: [{ replaceAllText: { occurrencesChanged: 3 } }],
      });
      const data = expectSuccess(
        await h.callTool('replace_text', {
          documentId: DOC_ID,
          searchText: 'foo',
          replacementText: 'bar',
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(DOC_ID, [
        { replaceAllText: { containsText: { text: 'foo', matchCase: false }, replaceText: 'bar' } },
      ]);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
      expect(data).toEqual({
        documentId: DOC_ID,
        url: DOC_URL,
        searchText: 'foo',
        matchCase: false,
        occurrencesChanged: 3,
        message: 'Replaced 3 occurrences.',
      });
    });

    it('passes matchCase and deletes occurrences when the replacement is empty', async () => {
      t.docs.batchUpdate.mockResolvedValue({
        replies: [{ replaceAllText: { occurrencesChanged: 1 } }],
      });
      const data = expectSuccess(
        await h.callTool('replace_text', {
          documentId: DOC_ID,
          searchText: 'DRAFT',
          replacementText: '',
          matchCase: true,
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(DOC_ID, [
        { replaceAllText: { containsText: { text: 'DRAFT', matchCase: true }, replaceText: '' } },
      ]);
      expect(data).toMatchObject({ occurrencesChanged: 1, message: 'Deleted 1 occurrence.' });
    });

    it('reports zero occurrences when nothing matched', async () => {
      t.docs.batchUpdate.mockResolvedValue({ replies: [{ replaceAllText: {} }] });
      const data = expectSuccess(
        await h.callTool('replace_text', {
          documentId: DOC_ID,
          searchText: 'missing',
          replacementText: 'x',
        }),
      );
      expect(data).toMatchObject({ occurrencesChanged: 0 });
      expect(data.message).toContain('not changed');
    });

    it('requires a non-empty searchText', async () => {
      const outcome = await h.callTool('replace_text', {
        documentId: DOC_ID,
        searchText: '',
        replacementText: 'x',
      });
      expect(outcome.isError).toBe(true);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('delete_text', () => {
    it('deletes a validated range', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const data = expectSuccess(
        await h.callTool('delete_text', { documentId: DOC_ID, startIndex: 1, endIndex: 7 }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID, BOUNDS_FIELDS);
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ deleteContentRange: { range: { startIndex: 1, endIndex: 7 } } }],
        AT_REVISION,
      );
      expect(data).toEqual({
        documentId: DOC_ID,
        url: DOC_URL,
        startIndex: 1,
        endIndex: 7,
        deletedLength: 6,
        newBodyEndIndex: 7,
        expectedTextVerified: false,
      });
    });

    it('refuses to delete the final newline (end beyond the body) with INVALID_INDEX', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const error = expectError(
        await h.callTool('delete_text', { documentId: DOC_ID, startIndex: 1, endIndex: 13 }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(error.details).toMatchObject({ maxEndIndex: 12 });
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('rejects an empty range with INVALID_INDEX', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const error = expectError(
        await h.callTool('delete_text', { documentId: DOC_ID, startIndex: 5, endIndex: 5 }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('refuses to delete when expectedText does not match the current text', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      const error = expectError(
        await h.callTool('delete_text', {
          documentId: DOC_ID,
          startIndex: 1,
          endIndex: 6,
          expectedText: 'Goodbye',
        }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(error.message).toContain('"Hello"');
      expect(error.details).toMatchObject({ startIndex: 1, endIndex: 6, actualText: 'Hello' });
      // The full document is read (not a partial mask) to compare the text.
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('deletes when expectedText matches, including across paragraphs', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello', 'world']));
      const data = expectSuccess(
        await h.callTool('delete_text', {
          documentId: DOC_ID,
          startIndex: 4,
          endIndex: 9,
          expectedText: 'lo\nwo',
        }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledTimes(1);
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ deleteContentRange: { range: { startIndex: 4, endIndex: 9 } } }],
        AT_REVISION,
      );
      expect(data).toMatchObject({
        deletedLength: 5,
        newBodyEndIndex: 8,
        expectedTextVerified: true,
      });
    });

    it('verifies expectedText for text inside a table cell', async () => {
      t.docs.getDocument.mockResolvedValue(
        makeDocument(['Intro', { table: [['alpha', 'beta']] }, 'Outro']),
      );
      expectSuccess(
        await h.callTool('delete_text', {
          documentId: DOC_ID,
          startIndex: 10,
          endIndex: 15,
          expectedText: 'alpha',
        }),
      );
      expect(t.docs.batchUpdate).toHaveBeenCalledWith(
        DOC_ID,
        [{ deleteContentRange: { range: { startIndex: 10, endIndex: 15 } } }],
        AT_REVISION,
      );
    });

    it('checks the range before comparing expectedText', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello']));
      const error = expectError(
        await h.callTool('delete_text', {
          documentId: DOC_ID,
          startIndex: 1,
          endIndex: 50,
          expectedText: 'Hello',
        }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_INDEX);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Google API error mapping', () => {
    it('maps a 403 from Google to PERMISSION_DENIED', async () => {
      t.docs.getDocument.mockRejectedValue({
        status: 403,
        message: 'The caller does not have permission',
      });
      const error = expectError(
        await h.callTool('insert_text', { documentId: DOC_ID, index: 1, text: 'x' }),
      );
      expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
      expect(t.docs.batchUpdate).not.toHaveBeenCalled();
    });

    it('maps a 400 from batchUpdate to INVALID_REQUEST with Google’s explanation', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['Hello world']));
      t.docs.batchUpdate.mockRejectedValue({
        status: 400,
        response: {
          status: 400,
          data: {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message:
                'Invalid requests[0].insertText: The insertion index must be inside the bounds of an existing paragraph.',
            },
          },
        },
      });
      const error = expectError(
        await h.callTool('insert_text', { documentId: DOC_ID, index: 3, text: 'x' }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_REQUEST);
      expect(error.message).toContain('inside the bounds of an existing paragraph');
    });

    it('maps a 404 on replace_text to DOCUMENT_NOT_FOUND', async () => {
      t.docs.batchUpdate.mockRejectedValue({
        status: 404,
        message: 'Requested entity was not found.',
      });
      const error = expectError(
        await h.callTool('replace_text', {
          documentId: DOC_ID,
          searchText: 'a',
          replacementText: 'b',
        }),
      );
      expect(error.code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    });
  });
});
