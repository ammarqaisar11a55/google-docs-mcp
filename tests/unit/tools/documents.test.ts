import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DriveFile } from '../../../src/google/drive-client.js';
import {
  buildDocumentQuery,
  DOCUMENT_FILE_FIELDS,
  DOCUMENT_LIST_FIELDS,
  GOOGLE_DOCS_MIME_TYPE,
} from '../../../src/services/drive-documents.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';
import { createTestDependencies, DOC_ID, makeDocument } from '../../helpers/fakes.js';
import { connectTestClient, expectError, expectSuccess } from '../../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const COPY_ID = '1CopyOfTheDocumentCopyOfTheDocument_-012345';
const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

function docFile(overrides: DriveFile = {}): DriveFile {
  return {
    id: DOC_ID,
    name: 'FYP Proposal',
    mimeType: GOOGLE_DOCS_MIME_TYPE,
    createdTime: '2026-01-01T10:00:00.000Z',
    modifiedTime: '2026-02-01T10:00:00.000Z',
    trashed: false,
    ...overrides,
  };
}

function googleError(status: number, reason?: string): Record<string, unknown> {
  return {
    status,
    message: `Request failed with status code ${status}`,
    response: {
      status,
      data: { error: { code: status, message: 'error', errors: reason ? [{ reason }] : [] } },
    },
  };
}

describe('document tools', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;

  beforeEach(async () => {
    t = createTestDependencies();
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
  });

  describe('create_document', () => {
    it('returns id, title and URL', async () => {
      t.docs.createDocument.mockResolvedValue({ documentId: DOC_ID, title: 'FYP Proposal' });
      const data = expectSuccess(await h.callTool('create_document', { title: 'FYP Proposal' }));
      expect(t.docs.createDocument).toHaveBeenCalledWith('FYP Proposal');
      expect(data).toEqual({
        documentId: DOC_ID,
        title: 'FYP Proposal',
        url: docUrl(DOC_ID),
      });
    });

    it('fails with GOOGLE_API_ERROR when Google returns no document ID', async () => {
      t.docs.createDocument.mockResolvedValue({ title: 'x' });
      expect(expectError(await h.callTool('create_document', { title: 'x' })).code).toBe(
        ErrorCode.GOOGLE_API_ERROR,
      );
    });

    it.each([
      ['an empty title', { title: '' }],
      ['a missing title', {}],
      ['a too-long title', { title: 'x'.repeat(501) }],
      ['a non-string title', { title: 42 }],
      ['unknown arguments', { title: 'ok', folder: 'root' }],
    ])('rejects %s without calling Google', async (_label, args) => {
      const outcome = await h.callTool('create_document', args);
      expect(outcome.isError).toBe(true);
      expect(outcome.payload.success).toBe(false);
      expect(t.docs.createDocument).not.toHaveBeenCalled();
    });
  });

  describe('get_document', () => {
    it('returns text, bodyEndIndex and structure', async () => {
      t.docs.getDocument.mockResolvedValue(
        makeDocument([{ heading: 'Intro' }, 'Hello world', { table: [['a', 'b']] }]),
      );
      const data = expectSuccess<{
        text: string;
        bodyEndIndex: number;
        structure: { type: string; startIndex: number; style?: string }[];
      }>(await h.callTool('get_document', { documentId: DOC_ID }));
      expect(data.text).toContain('Intro\nHello world\n');
      expect(data.text).toContain('a | b');
      expect(data.structure[0]).toMatchObject({
        type: 'paragraph',
        startIndex: 1,
        style: 'HEADING_1',
      });
      expect(data.structure.map((s) => s.type)).toEqual(['paragraph', 'paragraph', 'table']);
      expect(data.bodyEndIndex).toBeGreaterThan(18);
    });

    it('accepts a full Google Docs URL', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['x']));
      expectSuccess(
        await h.callTool('get_document', {
          documentId: `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`,
        }),
      );
      expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID);
    });

    it('truncates long text and can omit the structure', async () => {
      t.docs.getDocument.mockResolvedValue(makeDocument(['a'.repeat(300)]));
      const data = expectSuccess(
        await h.callTool('get_document', {
          documentId: DOC_ID,
          maxTextLength: 100,
          includeStructure: false,
        }),
      );
      expect(data).toMatchObject({
        text: 'a'.repeat(100),
        textLength: 301,
        textTruncated: true,
        url: docUrl(DOC_ID),
        revisionId: 'rev-1',
      });
      expect(data).not.toHaveProperty('structure');
    });

    it('rejects malformed document IDs without calling Google', async () => {
      const error = expectError(
        await h.callTool('get_document', { documentId: '../../etc/passwd' }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_DOCUMENT_ID);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });

    it('rejects out-of-range maxTextLength', async () => {
      const outcome = await h.callTool('get_document', { documentId: DOC_ID, maxTextLength: 10 });
      expect(outcome.isError).toBe(true);
      expect(t.docs.getDocument).not.toHaveBeenCalled();
    });

    it('maps Google 404 to DOCUMENT_NOT_FOUND', async () => {
      t.docs.getDocument.mockRejectedValue({
        status: 404,
        message: 'Requested entity was not found.',
      });
      const error = expectError(await h.callTool('get_document', { documentId: DOC_ID }));
      expect(error.code).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
      expect(error.retryable).toBe(false);
    });
  });

  describe('list_documents', () => {
    it('lists recent documents with defaults', async () => {
      t.drive.listFiles.mockResolvedValue({
        files: [docFile(), docFile({ id: COPY_ID, name: 'Notes', createdTime: null })],
        nextPageToken: undefined,
      });
      const data = expectSuccess(await h.callTool('list_documents'));
      expect(t.drive.listFiles).toHaveBeenCalledWith({
        q: buildDocumentQuery({}),
        pageSize: 20,
        pageToken: undefined,
        orderBy: 'modifiedTime desc',
        fields: DOCUMENT_LIST_FIELDS,
      });
      expect(data).toEqual({
        documents: [
          {
            documentId: DOC_ID,
            name: 'FYP Proposal',
            url: docUrl(DOC_ID),
            createdTime: '2026-01-01T10:00:00.000Z',
            modifiedTime: '2026-02-01T10:00:00.000Z',
          },
          {
            documentId: COPY_ID,
            name: 'Notes',
            url: docUrl(COPY_ID),
            createdTime: null,
            modifiedTime: '2026-02-01T10:00:00.000Z',
          },
        ],
        count: 2,
        nextPageToken: null,
      });
    });

    it('passes search, limit and pageToken, and returns the next page token', async () => {
      t.drive.listFiles.mockResolvedValue({ files: [docFile()], nextPageToken: 'page-3' });
      const data = expectSuccess(
        await h.callTool('list_documents', {
          search: "Ammar's FYP",
          limit: 5,
          pageToken: 'page-2',
        }),
      );
      const params = t.drive.listFiles.mock.calls[0]![0];
      expect(params).toMatchObject({ pageSize: 5, pageToken: 'page-2' });
      expect(params.q).toBe(buildDocumentQuery({ nameContains: "Ammar's FYP" }));
      expect(params.q).toContain("name contains 'Ammar\\'s FYP'");
      expect(params.q).toContain('trashed=false');
      expect(data).toMatchObject({ count: 1, nextPageToken: 'page-3' });
    });

    it('returns an empty page', async () => {
      t.drive.listFiles.mockResolvedValue({ files: [], nextPageToken: undefined });
      expect(expectSuccess(await h.callTool('list_documents', { limit: 1 }))).toEqual({
        documents: [],
        count: 0,
        nextPageToken: null,
      });
    });

    it.each([
      ['limit 0', { limit: 0 }],
      ['limit above 100', { limit: 101 }],
      ['a fractional limit', { limit: 2.5 }],
      ['an empty search', { search: '' }],
      ['an empty pageToken', { pageToken: '' }],
    ])('rejects %s without calling Google', async (_label, args) => {
      const outcome = await h.callTool('list_documents', args);
      expect(outcome.isError).toBe(true);
      expect(t.drive.listFiles).not.toHaveBeenCalled();
    });

    it('maps 429 to a retryable RATE_LIMITED error', async () => {
      t.drive.listFiles.mockRejectedValue(googleError(429));
      const error = expectError(await h.callTool('list_documents'));
      expect(error.code).toBe(ErrorCode.RATE_LIMITED);
      expect(error.retryable).toBe(true);
    });

    it('maps 403 rateLimitExceeded to RATE_LIMITED', async () => {
      t.drive.listFiles.mockRejectedValue(googleError(403, 'rateLimitExceeded'));
      expect(expectError(await h.callTool('list_documents')).code).toBe(ErrorCode.RATE_LIMITED);
    });
  });

  describe('copy_document', () => {
    it('copies a Google Doc and returns the new document', async () => {
      t.drive.getFile.mockResolvedValue(docFile());
      t.drive.copyFile.mockResolvedValue({ id: COPY_ID, name: 'FYP Proposal (backup)' });
      const data = expectSuccess(
        await h.callTool('copy_document', {
          documentId: docUrl(DOC_ID),
          newTitle: 'FYP Proposal (backup)',
        }),
      );
      expect(t.drive.getFile).toHaveBeenCalledWith(DOC_ID, DOCUMENT_FILE_FIELDS);
      expect(t.drive.copyFile).toHaveBeenCalledWith(
        DOC_ID,
        'FYP Proposal (backup)',
        DOCUMENT_FILE_FIELDS,
      );
      expect(data).toEqual({
        documentId: COPY_ID,
        title: 'FYP Proposal (backup)',
        url: docUrl(COPY_ID),
        sourceDocumentId: DOC_ID,
      });
    });

    it('refuses to copy files that are not Google Docs', async () => {
      t.drive.getFile.mockResolvedValue(
        docFile({ mimeType: 'application/vnd.google-apps.spreadsheet' }),
      );
      const error = expectError(
        await h.callTool('copy_document', { documentId: DOC_ID, newTitle: 'Copy' }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
      expect(t.drive.copyFile).not.toHaveBeenCalled();
    });

    it('fails with GOOGLE_API_ERROR when Google returns no copy ID', async () => {
      t.drive.getFile.mockResolvedValue(docFile());
      t.drive.copyFile.mockResolvedValue({ name: 'Copy' });
      expect(
        expectError(await h.callTool('copy_document', { documentId: DOC_ID, newTitle: 'Copy' }))
          .code,
      ).toBe(ErrorCode.GOOGLE_API_ERROR);
    });

    it('rejects an empty newTitle', async () => {
      const outcome = await h.callTool('copy_document', { documentId: DOC_ID, newTitle: '' });
      expect(outcome.isError).toBe(true);
      expect(t.drive.getFile).not.toHaveBeenCalled();
    });

    it('maps 404 on the source to DOCUMENT_NOT_FOUND', async () => {
      t.drive.getFile.mockRejectedValue(googleError(404));
      expect(
        expectError(await h.callTool('copy_document', { documentId: DOC_ID, newTitle: 'Copy' }))
          .code,
      ).toBe(ErrorCode.DOCUMENT_NOT_FOUND);
    });
  });

  describe('delete_document', () => {
    it('moves the document to the Drive trash', async () => {
      t.drive.getFile.mockResolvedValue(docFile());
      t.drive.trashFile.mockResolvedValue(docFile({ trashed: true }));
      const data = expectSuccess(await h.callTool('delete_document', { documentId: DOC_ID }));
      expect(t.drive.trashFile).toHaveBeenCalledWith(DOC_ID, DOCUMENT_FILE_FIELDS);
      expect(data).toMatchObject({
        documentId: DOC_ID,
        title: 'FYP Proposal',
        url: docUrl(DOC_ID),
        trashed: true,
      });
      expect(String(data.message)).toMatch(/trash/i);
      expect(String(data.message)).toMatch(/restored/i);
    });

    it.each(['application/pdf', 'application/vnd.google-apps.spreadsheet', undefined])(
      'refuses to trash a file with mime type %s',
      async (mimeType) => {
        t.drive.getFile.mockResolvedValue(docFile({ mimeType }));
        const error = expectError(await h.callTool('delete_document', { documentId: DOC_ID }));
        expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT);
        expect(error.message).toContain('not a Google Docs document');
        expect(t.drive.trashFile).not.toHaveBeenCalled();
      },
    );

    it('does not trash an already-trashed document again', async () => {
      t.drive.getFile.mockResolvedValue(docFile({ trashed: true }));
      const data = expectSuccess(await h.callTool('delete_document', { documentId: DOC_ID }));
      expect(t.drive.trashFile).not.toHaveBeenCalled();
      expect(data).toMatchObject({ trashed: true });
      expect(String(data.message)).toMatch(/already/i);
    });

    it('rejects malformed document IDs without calling Google', async () => {
      const error = expectError(
        await h.callTool('delete_document', { documentId: `${DOC_ID}?supportsAllDrives=false` }),
      );
      expect(error.code).toBe(ErrorCode.INVALID_DOCUMENT_ID);
      expect(t.drive.getFile).not.toHaveBeenCalled();
    });

    it('maps 403 to PERMISSION_DENIED', async () => {
      t.drive.getFile.mockResolvedValue(docFile());
      t.drive.trashFile.mockRejectedValue(googleError(403, 'insufficientFilePermissions'));
      const error = expectError(await h.callTool('delete_document', { documentId: DOC_ID }));
      expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
      expect(error.retryable).toBe(false);
    });
  });

  describe('error handling', () => {
    it('maps network failures to a retryable NETWORK_ERROR', async () => {
      t.docs.createDocument.mockRejectedValue(
        Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      );
      const error = expectError(await h.callTool('create_document', { title: 'x' }));
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.retryable).toBe(true);
    });

    it('maps Google 5xx to a retryable GOOGLE_API_ERROR', async () => {
      t.docs.getDocument.mockRejectedValue(googleError(503));
      const error = expectError(await h.callTool('get_document', { documentId: DOC_ID }));
      expect(error.code).toBe(ErrorCode.GOOGLE_API_ERROR);
      expect(error.retryable).toBe(true);
    });

    it('returns the standard error envelope without internal details', async () => {
      t.docs.getDocument.mockRejectedValue(new Error('secret internal failure at /home/user/x.ts'));
      const outcome = await h.callTool('get_document', { documentId: DOC_ID });
      expect(outcome.isError).toBe(true);
      expect(outcome.payload).toEqual({
        success: false,
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: expect.any(String) as unknown,
          retryable: false,
        },
      });
      expect(outcome.text).not.toContain('/home/user');
      expect(outcome.text).not.toContain('stack');
    });

    it('invalidates the auth cache when a tool reports NOT_AUTHENTICATED', async () => {
      t.docs.createDocument.mockRejectedValue(new AppError(ErrorCode.NOT_AUTHENTICATED, 'no'));
      expectError(await h.callTool('create_document', { title: 'x' }));
      expect(t.auth.invalidate).toHaveBeenCalled();
    });

    it('invalidates the auth cache when Google answers 401', async () => {
      t.drive.listFiles.mockRejectedValue(googleError(401));
      expect(expectError(await h.callTool('list_documents')).code).toBe(ErrorCode.AUTH_EXPIRED);
      expect(t.auth.invalidate).toHaveBeenCalled();
    });

    it('does not invalidate the auth cache for other errors', async () => {
      t.drive.listFiles.mockRejectedValue(googleError(404));
      expectError(await h.callTool('list_documents'));
      expect(t.auth.invalidate).not.toHaveBeenCalled();
    });
  });
});
