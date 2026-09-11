import type { docs_v1 } from '@googleapis/docs';
import type { OAuth2Client } from 'google-auth-library';
import { vi } from 'vitest';
import type { AuthService, AuthStatus } from '../../src/auth/google-auth.js';
import type { DocsClient, GoogleDocument } from '../../src/google/docs-client.js';
import type { DriveClient } from '../../src/google/drive-client.js';
import type { ServerDependencies } from '../../src/server.js';
import { createServices } from '../../src/services/index.js';

/** A realistic 44-character Google Docs ID for tests. */
export const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

export function createFakeDocsClient() {
  return {
    getDocument: vi.fn<DocsClient['getDocument']>(),
    createDocument: vi.fn<DocsClient['createDocument']>(),
    batchUpdate: vi.fn<DocsClient['batchUpdate']>().mockResolvedValue({ replies: [] }),
  } satisfies DocsClient;
}

export function createFakeDriveClient() {
  return {
    listFiles: vi.fn<DriveClient['listFiles']>(),
    getFile: vi.fn<DriveClient['getFile']>(),
    copyFile: vi.fn<DriveClient['copyFile']>(),
    trashFile: vi.fn<DriveClient['trashFile']>(),
  } satisfies DriveClient;
}

export const AUTHENTICATED_STATUS: AuthStatus = {
  authenticated: true,
  credentialsConfigured: true,
  requiredScopes: [],
  grantedScopes: [],
  missingScopes: [],
  hasRefreshToken: true,
  accessTokenExpiresAt: null,
  authorizationPending: false,
};

export function createFakeAuthService() {
  return {
    getAuthorizedClient: vi.fn<AuthService['getAuthorizedClient']>(() =>
      Promise.resolve({} as OAuth2Client),
    ),
    getStatus: vi.fn<AuthService['getStatus']>(() => Promise.resolve(AUTHENTICATED_STATUS)),
    startAuthorization: vi.fn<AuthService['startAuthorization']>(),
    signOut: vi.fn<AuthService['signOut']>(() => Promise.resolve({ revoked: true })),
    invalidate: vi.fn<AuthService['invalidate']>(),
  } satisfies AuthService;
}

export function createTestDependencies() {
  const docs = createFakeDocsClient();
  const drive = createFakeDriveClient();
  const auth = createFakeAuthService();
  const deps: ServerDependencies = { auth, services: createServices(docs, drive) };
  return { deps, docs, drive, auth };
}

export type BodyItem =
  string | { heading: string; style?: string } | { table: string[][] } | { bullet: string };

/**
 * Builds a Google Docs API document with correct indexes, the way the real API does:
 * a section break at [0,1), then paragraphs (each ending in "\n") and tables.
 */
export function makeDocument(
  items: BodyItem[] = [],
  options: { documentId?: string; title?: string; revisionId?: string } = {},
): GoogleDocument {
  let index = 1;
  const content: docs_v1.Schema$StructuralElement[] = [
    { startIndex: 0, endIndex: 1, sectionBreak: { sectionStyle: {} } },
  ];

  const paragraph = (text: string, style = 'NORMAL_TEXT', bullet = false) => {
    const full = text.endsWith('\n') ? text : `${text}\n`;
    const element: docs_v1.Schema$StructuralElement = {
      startIndex: index,
      endIndex: index + full.length,
      paragraph: {
        elements: [
          { startIndex: index, endIndex: index + full.length, textRun: { content: full } },
        ],
        paragraphStyle: { namedStyleType: style },
        ...(bullet ? { bullet: { listId: 'list-1' } } : {}),
      },
    };
    index += full.length;
    return element;
  };

  const all = items.length > 0 ? items : [''];
  for (const item of all) {
    if (typeof item === 'string') content.push(paragraph(item));
    else if ('heading' in item) content.push(paragraph(item.heading, item.style ?? 'HEADING_1'));
    else if ('bullet' in item) content.push(paragraph(item.bullet, 'NORMAL_TEXT', true));
    else {
      const tableStart = index;
      index += 1; // table start marker
      const tableRows = item.table.map((row) => {
        const rowStart = index;
        index += 1; // row marker
        const tableCells = row.map((cellText) => {
          const cellStart = index;
          index += 1; // cell marker
          const cellParagraph = paragraph(cellText);
          return { startIndex: cellStart, endIndex: index, content: [cellParagraph] };
        });
        return { startIndex: rowStart, endIndex: index, tableCells };
      });
      index += 1; // table end
      content.push({
        startIndex: tableStart,
        endIndex: index,
        table: { rows: item.table.length, columns: item.table[0]?.length ?? 0, tableRows },
      });
    }
  }

  return {
    documentId: options.documentId ?? DOC_ID,
    title: options.title ?? 'Test Document',
    revisionId: options.revisionId ?? 'rev-1',
    body: { content },
  };
}
