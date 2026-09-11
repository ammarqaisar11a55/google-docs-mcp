import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GoogleDocument } from '../../../src/google/docs-client.js';
import type { TextOccurrence } from '../../../src/services/search-service.js';
import { ErrorCode } from '../../../src/utils/errors.js';
import { createTestDependencies, DOC_ID, makeDocument } from '../../helpers/fakes.js';
import { connectTestClient, expectError, expectSuccess } from '../../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const DOCS_FILTER = "mimeType='application/vnd.google-apps.document' and trashed=false";

interface SearchData {
  query: string;
  searchIn: string;
  documents: { documentId: string; name: string; url: string; modifiedTime: string | null }[];
  count: number;
  nextPageToken: string | null;
  note: string;
}

interface FindData {
  documentId: string;
  occurrences: TextOccurrence[];
  totalMatches: number;
  truncated: boolean;
}

/** Maps every document index to its character, straight from the raw API document. */
function indexMap(document: GoogleDocument): Map<number, string> {
  const map = new Map<number, string>();
  const visit = (content: NonNullable<GoogleDocument['body']>['content']) => {
    for (const element of content ?? []) {
      for (const run of element.paragraph?.elements ?? []) {
        const text = run.textRun?.content ?? '';
        for (let i = 0; i < text.length; i += 1) map.set((run.startIndex ?? 0) + i, text[i]!);
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) visit(cell.content);
      }
    }
  };
  visit(document.body?.content);
  return map;
}

function textAt(map: Map<number, string>, start: number, end: number): string {
  let text = '';
  for (let i = start; i < end; i += 1) text += map.get(i) ?? '';
  return text;
}

describe('search tools', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;

  beforeEach(async () => {
    t = createTestDependencies();
    t.drive.listFiles.mockResolvedValue({ files: [], nextPageToken: undefined });
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
  });

  describe('search_documents', () => {
    it('searches names with a name-contains query, ordered by modifiedTime', async () => {
      t.drive.listFiles.mockResolvedValue({
        files: [
          {
            id: DOC_ID,
            name: 'FYP Proposal',
            createdTime: '2026-01-01T00:00:00Z',
            modifiedTime: '2026-02-01T00:00:00Z',
          },
        ],
        nextPageToken: undefined,
      });
      const data = expectSuccess<SearchData>(
        await h.callTool('search_documents', { query: 'FYP', searchIn: 'name', limit: 5 }),
      );
      expect(t.drive.listFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          q: `${DOCS_FILTER} and (name contains 'FYP')`,
          pageSize: 5,
          orderBy: 'modifiedTime desc',
        }),
      );
      expect(data).toMatchObject({
        query: 'FYP',
        searchIn: 'name',
        count: 1,
        nextPageToken: null,
        documents: [
          {
            documentId: DOC_ID,
            name: 'FYP Proposal',
            url: `https://docs.google.com/document/d/${DOC_ID}/edit`,
            createdTime: '2026-01-01T00:00:00Z',
            modifiedTime: '2026-02-01T00:00:00Z',
          },
        ],
      });
      expect(data.note).toMatch(/document name/i);
      expect(data.note).toMatch(/start with the query/i);
    });

    it('uses fullText for content searches and does not send orderBy', async () => {
      const data = expectSuccess<SearchData>(
        await h.callTool('search_documents', { query: 'budget', searchIn: 'content' }),
      );
      const params = t.drive.listFiles.mock.calls[0]![0];
      expect(params.q).toBe(`${DOCS_FILTER} and (fullText contains 'budget')`);
      expect(params.orderBy).toBeUndefined();
      expect(data.note).toMatch(/full-text/i);
    });

    it('defaults to searching name OR content with limit 20', async () => {
      const data = expectSuccess<SearchData>(
        await h.callTool('search_documents', { query: 'FYP' }),
      );
      const params = t.drive.listFiles.mock.calls[0]![0];
      expect(params.q).toBe(`${DOCS_FILTER} and (name contains 'FYP' or fullText contains 'FYP')`);
      expect(params.pageSize).toBe(20);
      expect(params.orderBy).toBeUndefined();
      expect(data.searchIn).toBe('both');
    });

    it('escapes quotes and backslashes so the query cannot be altered', async () => {
      await h.callTool('search_documents', {
        query: "O'Brien \\ x' or name contains '",
        searchIn: 'both',
      });
      const params = t.drive.listFiles.mock.calls[0]![0];
      const escaped = "O\\'Brien \\\\ x\\' or name contains \\'";
      expect(params.q).toBe(
        `${DOCS_FILTER} and (name contains '${escaped}' or fullText contains '${escaped}')`,
      );
    });

    it('passes pageToken through and returns nextPageToken', async () => {
      t.drive.listFiles.mockResolvedValue({ files: [], nextPageToken: 'next-page' });
      const data = expectSuccess<SearchData>(
        await h.callTool('search_documents', { query: 'FYP', pageToken: 'page-2' }),
      );
      expect(t.drive.listFiles.mock.calls[0]![0].pageToken).toBe('page-2');
      expect(data.nextPageToken).toBe('next-page');
    });

    it('trims the query and rejects whitespace-only queries', async () => {
      const data = expectSuccess<SearchData>(
        await h.callTool('search_documents', { query: '  FYP  ', searchIn: 'name' }),
      );
      expect(data.query).toBe('FYP');
      const error = expectError(await h.callTool('search_documents', { query: '   ' }));
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(t.drive.listFiles).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid arguments without calling Drive', async () => {
      expect((await h.callTool('search_documents', { query: 'x', limit: 0 })).isError).toBe(true);
      expect(
        (await h.callTool('search_documents', { query: 'x', searchIn: 'title' })).isError,
      ).toBe(true);
      expect((await h.callTool('search_documents', { query: '' })).isError).toBe(true);
      expect(t.drive.listFiles).not.toHaveBeenCalled();
    });

    it('maps Drive errors to safe error codes', async () => {
      t.drive.listFiles.mockRejectedValue({ status: 429, message: 'raw quota details' });
      const error = expectError(await h.callTool('search_documents', { query: 'x' }));
      expect(error.code).toBe(ErrorCode.RATE_LIMITED);
      expect(error.message).not.toContain('raw quota details');
    });
  });

  describe('find_text', () => {
    const document = makeDocument([
      { heading: 'Project Plan' },
      'The plan is a good plan. PLAN ahead.',
      {
        table: [
          ['Plan A', 'Budget'],
          ['x', 'plan b'],
        ],
      },
    ]);

    beforeEach(() => {
      t.docs.getDocument.mockResolvedValue(document);
    });

    it('finds case-insensitive matches with exact indexes, including table cells', async () => {
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'plan' }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID);
      expect(data.totalMatches).toBe(6);
      expect(data.truncated).toBe(false);
      expect(data.occurrences.map((o) => [o.startIndex, o.endIndex])).toEqual([
        [9, 13],
        [18, 22],
        [33, 37],
        [39, 43],
        [54, 58],
        [74, 78],
      ]);
      expect(data.occurrences.map((o) => o.matchedText)).toEqual([
        'Plan',
        'plan',
        'plan',
        'PLAN',
        'Plan',
        'plan',
      ]);
      expect(data.occurrences[0]).toMatchObject({ paragraphStyle: 'HEADING_1', inTable: false });
      expect(data.occurrences[1]).toMatchObject({ paragraphStyle: 'NORMAL_TEXT', inTable: false });
      expect(data.occurrences[4]).toMatchObject({ inTable: true });
      expect(data.occurrences[5]).toMatchObject({ inTable: true, context: 'plan b' });

      // Cross-check every range against the raw document content.
      const map = indexMap(document);
      for (const occurrence of data.occurrences) {
        expect(textAt(map, occurrence.startIndex, occurrence.endIndex)).toBe(
          occurrence.matchedText,
        );
      }
    });

    it('respects matchCase', async () => {
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'plan', matchCase: true }),
      );
      expect(data.occurrences.map((o) => o.startIndex)).toEqual([18, 33, 74]);
      expect(data.totalMatches).toBe(3);
    });

    it('truncates to maxResults but reports totalMatches', async () => {
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'plan', maxResults: 2 }),
      );
      expect(data.occurrences).toHaveLength(2);
      expect(data.totalMatches).toBe(6);
      expect(data.truncated).toBe(true);
    });

    it('includes a context snippet around the match', async () => {
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'good' }),
      );
      expect(data.occurrences).toHaveLength(1);
      expect(data.occurrences[0]!.context).toBe('The plan is a good plan. PLAN ahead.');
    });

    it('treats regex special characters literally', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['x a.b (c) axb (c) [a.b (c)]']));
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'a.b (c)' }),
      );
      expect(data.occurrences.map((o) => [o.startIndex, o.endIndex])).toEqual([
        [3, 10],
        [20, 27],
      ]);
    });

    it('keeps exact UTF-16 indexes when case mapping changes string length', async () => {
      // "İ".toLowerCase() is two code units; lowercasing the text would shift every index.
      t.docs.getDocument.mockResolvedValue(makeDocument(['İstanbul 😀 City']));
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'city' }),
      );
      // "İstanbul " = 9 code units, "😀 " = 3 code units -> offset 12 -> index 13.
      expect(data.occurrences).toEqual([
        expect.objectContaining({ startIndex: 13, endIndex: 17, matchedText: 'City' }),
      ]);
    });

    it('never matches across paragraphs or includes the paragraph newline', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['end', 'start']));
      const data = expectSuccess<FindData>(
        await h.callTool('find_text', { documentId: DOC_ID, text: 'end\nstart' }),
      );
      expect(data.totalMatches).toBe(0);
      expect(data.occurrences).toEqual([]);
    });

    it('accepts a document URL', async () => {
      expectSuccess(
        await h.callTool('find_text', {
          documentId: `https://docs.google.com/document/d/${DOC_ID}/edit`,
          text: 'plan',
        }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID);
    });

    it('rejects an invalid document ID without calling Google', async () => {
      const error = expectError(
        await h.callTool('find_text', { documentId: 'bad/../id', text: 'plan' }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_DOCUMENT_ID);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });

    it('maps Google 404 to DOCUMENT_NOT_FOUND', async () => {
      t.docs.getDocument.mockRejectedValue({ status: 404, message: 'not found' });
      const error = expectError(await h.callTool('find_text', { documentId: DOC_ID, text: 'x' }));
      expect(error.code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    });
  });

  it('marks both tools read-only', async () => {
    const { tools } = await h.client.listTools();
    for (const name of ['search_documents', 'find_text']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.description).toBeTruthy();
    }
  });
});
