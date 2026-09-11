import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultTokenPath, loadConfig } from '../../src/config/config.js';
import { createDependencies } from '../../src/server.js';
import { connectTestClient, expectSuccess } from '../helpers/harness.js';

/**
 * Optional end-to-end test against a real Google account. Skipped unless
 * RUN_GOOGLE_INTEGRATION_TESTS=true. Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (env or
 * .env) and a token file from `npm run auth` (GOOGLE_INTEGRATION_TOKEN_PATH, or the default
 * token path). Every document it creates is moved to the Drive trash afterwards.
 */
const RUN = process.env.RUN_GOOGLE_INTEGRATION_TESTS === 'true';
const TIMEOUT_MS = 60_000;
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

interface DocRef {
  documentId: string;
  title: string;
  url: string;
}

describe.skipIf(!RUN)('Google API integration (real account)', () => {
  const marker = `mcp-it-${Date.now().toString(36)}`;
  const title = `${marker} Integration Test`;
  const createdIds: string[] = [];
  // Undefined until beforeAll connects (and it stays undefined if that setup fails).
  let harness: Harness | undefined;
  let documentId = '';

  const h = {
    callTool: (...args: Parameters<Harness['callTool']>) => {
      if (!harness) throw new Error('The integration test client is not connected.');
      return harness.callTool(...args);
    },
  };

  beforeAll(async () => {
    const envFile = path.join(REPO_ROOT, '.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    const config = loadConfig({
      ...process.env,
      // vitest.config.ts points GOOGLE_TOKEN_PATH at a nonexistent file for ordinary runs.
      GOOGLE_TOKEN_PATH: process.env.GOOGLE_INTEGRATION_TOKEN_PATH ?? defaultTokenPath(),
    });
    harness = await connectTestClient(createDependencies(config));
    const status = expectSuccess<{ authenticated: boolean }>(await h.callTool('get_auth_status'));
    if (!status.authenticated) {
      throw new Error('Not signed in to Google. Run `npm run auth` before the integration tests.');
    }
  }, TIMEOUT_MS);

  afterAll(async () => {
    if (!harness) return;
    for (const id of createdIds) {
      // Trash only (recoverable); keep cleaning up even if one call fails.
      await harness.callTool('delete_document', { documentId: id }).catch(() => undefined);
    }
    await harness.close();
  }, TIMEOUT_MS);

  it(
    'creates a document',
    async () => {
      const doc = expectSuccess<DocRef>(await h.callTool('create_document', { title }));
      createdIds.push(doc.documentId);
      documentId = doc.documentId;
      expect(doc.title).toBe(title);
      expect(doc.url).toContain(doc.documentId);
    },
    TIMEOUT_MS,
  );

  it(
    'appends text and reads it back',
    async () => {
      expectSuccess(
        await h.callTool('append_text', {
          documentId,
          text: 'Hello integration world.\nSecond paragraph mentions the budget.',
        }),
      );
      const doc = expectSuccess<{ text: string }>(await h.callTool('get_document', { documentId }));
      expect(doc.text).toContain('Hello integration world.');
      expect(doc.text).toContain('Second paragraph mentions the budget.');
    },
    TIMEOUT_MS,
  );

  it(
    'finds text and formats it bold',
    async () => {
      const found = expectSuccess<{
        occurrences: { startIndex: number; endIndex: number; matchedText: string }[];
      }>(await h.callTool('find_text', { documentId, text: 'integration' }));
      expect(found.occurrences).toHaveLength(1);
      const [occurrence] = found.occurrences;
      expect(occurrence!.matchedText).toBe('integration');
      expectSuccess(
        await h.callTool('format_text', {
          documentId,
          startIndex: occurrence!.startIndex,
          endIndex: occurrence!.endIndex,
          bold: true,
        }),
      );
    },
    TIMEOUT_MS,
  );

  it(
    'replaces text',
    async () => {
      expectSuccess(
        await h.callTool('replace_text', {
          documentId,
          searchText: 'budget',
          replacementText: 'forecast',
          matchCase: false,
        }),
      );
      const doc = expectSuccess<{ text: string }>(await h.callTool('get_document', { documentId }));
      expect(doc.text).toContain('mentions the forecast.');
      expect(doc.text).not.toContain('budget');
    },
    TIMEOUT_MS,
  );

  it(
    'finds the document by name',
    async () => {
      const result = expectSuccess<{ documents: { documentId: string }[] }>(
        await h.callTool('search_documents', { query: marker, searchIn: 'name' }),
      );
      expect(result.documents.map((doc) => doc.documentId)).toContain(documentId);
    },
    TIMEOUT_MS,
  );

  it(
    'copies the document',
    async () => {
      const copy = expectSuccess<DocRef>(
        await h.callTool('copy_document', { documentId, newTitle: `${title} (copy)` }),
      );
      createdIds.push(copy.documentId);
      expect(copy.documentId).not.toBe(documentId);
      const doc = expectSuccess<{ text: string }>(
        await h.callTool('get_document', { documentId: copy.documentId }),
      );
      expect(doc.text).toContain('Hello integration world.');
    },
    TIMEOUT_MS,
  );
});
