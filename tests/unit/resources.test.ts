import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, ErrorCode } from '../../src/utils/errors.js';
import { createTestDependencies, DOC_ID, makeDocument } from '../helpers/fakes.js';
import { connectTestClient } from '../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const DOC_URI = `google-docs://document/${DOC_ID}`;

describe('document resources', () => {
  let t: ReturnType<typeof createTestDependencies>;
  let h: Harness;

  beforeEach(async () => {
    t = createTestDependencies();
    h = await connectTestClient(t.deps);
  });

  afterEach(async () => {
    await h.close();
  });

  it('lists the google-docs://document/{documentId} template', async () => {
    const { resourceTemplates } = await h.client.listResourceTemplates();
    expect(resourceTemplates).toEqual([
      expect.objectContaining({
        name: 'google-doc',
        uriTemplate: 'google-docs://document/{documentId}',
        mimeType: 'text/plain',
        title: expect.any(String) as unknown,
        description: expect.any(String) as unknown,
      }),
    ]);
  });

  it('reads the current document text with the title first', async () => {
    t.docs.getDocument.mockResolvedValue(
      makeDocument([{ heading: 'Intro' }, 'Hello world', { table: [['a', 'b']] }], {
        title: 'FYP Proposal',
      }),
    );
    const result = await h.client.readResource({ uri: DOC_URI });
    expect(t.docs.getDocument).toHaveBeenCalledWith(DOC_ID);
    expect(result.contents).toHaveLength(1);
    const [content] = result.contents;
    expect(content).toMatchObject({ uri: DOC_URI, mimeType: 'text/plain' });
    const text = content && 'text' in content ? content.text : '';
    expect(text.startsWith('FYP Proposal\n\n')).toBe(true);
    expect(text).toContain('Intro\nHello world\n');
    expect(text).toContain('a | b');
  });

  it('lists recently modified documents as resources', async () => {
    t.drive.listFiles.mockResolvedValue({
      files: [
        { id: DOC_ID, name: 'FYP Proposal', modifiedTime: '2026-02-01T00:00:00Z' },
        { id: 'zyxwvutsrqponmlk', name: 'Notes' },
      ],
      nextPageToken: 'more',
    });
    const { resources } = await h.client.listResources();
    expect(t.drive.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25, orderBy: 'modifiedTime desc' }),
    );
    expect(resources).toEqual([
      expect.objectContaining({ uri: DOC_URI, name: 'FYP Proposal', mimeType: 'text/plain' }),
      expect.objectContaining({
        uri: 'google-docs://document/zyxwvutsrqponmlk',
        name: 'Notes',
        mimeType: 'text/plain',
      }),
    ]);
  });

  it('returns an empty resource list when listing fails', async () => {
    t.drive.listFiles.mockRejectedValue(
      new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in to Google.'),
    );
    const { resources } = await h.client.listResources();
    expect(resources).toEqual([]);
  });

  it('surfaces only the safe error message when reading fails', async () => {
    t.docs.getDocument.mockRejectedValue({
      status: 404,
      message: 'raw Google error with internal details',
      response: { data: { error: { message: 'raw Google error with internal details' } } },
    });
    const error = await h.client.readResource({ uri: DOC_URI }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('could not be found');
    expect(message).not.toContain('raw Google error');
  });

  it('rejects an invalid document ID in the URI without calling Google', async () => {
    await expect(h.client.readResource({ uri: 'google-docs://document/short' })).rejects.toThrow(
      /document ID is not valid/,
    );
    expect(t.docs.getDocument).not.toHaveBeenCalled();
  });
});
