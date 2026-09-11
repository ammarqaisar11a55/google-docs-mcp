import { describe, expect, it } from 'vitest';
import {
  buildDocumentQuery,
  DOCUMENT_FILE_FIELDS,
  DOCUMENT_LIST_FIELDS,
  GOOGLE_DOCS_MIME_TYPE,
  toDocumentSummary,
} from '../../../src/services/drive-documents.js';
import { DOC_ID } from '../../helpers/fakes.js';

const BASE = `mimeType='${GOOGLE_DOCS_MIME_TYPE}' and trashed=false`;

/**
 * Splits a Drive query into its string literals (honouring backslash escapes, the way Drive
 * parses them) and the query "skeleton" outside those literals.
 */
function tokenize(query: string): { skeleton: string; literals: string[] } {
  let skeleton = '';
  const literals: string[] = [];
  let i = 0;
  while (i < query.length) {
    const char = query[i]!;
    if (char !== "'") {
      skeleton += char;
      i += 1;
      continue;
    }
    let literal = '';
    i += 1;
    let closed = false;
    while (i < query.length) {
      const inner = query[i]!;
      if (inner === '\\') {
        literal += query[i + 1] ?? '';
        i += 2;
      } else if (inner === "'") {
        i += 1;
        closed = true;
        break;
      } else {
        literal += inner;
        i += 1;
      }
    }
    if (!closed) throw new Error('Unterminated string literal');
    skeleton += "''";
    literals.push(literal);
  }
  return { skeleton, literals };
}

describe('buildDocumentQuery', () => {
  it('restricts results to non-trashed Google Docs by default', () => {
    expect(buildDocumentQuery()).toBe(BASE);
    expect(buildDocumentQuery({ nameContains: '' })).toBe(BASE);
  });

  it('adds a name clause', () => {
    expect(buildDocumentQuery({ nameContains: 'FYP' })).toBe(`${BASE} and (name contains 'FYP')`);
  });

  it('adds a full-text clause', () => {
    expect(buildDocumentQuery({ fullTextContains: 'budget' })).toBe(
      `${BASE} and (fullText contains 'budget')`,
    );
  });

  it('ORs name and full-text clauses inside one group', () => {
    expect(buildDocumentQuery({ nameContains: 'FYP', fullTextContains: 'FYP' })).toBe(
      `${BASE} and (name contains 'FYP' or fullText contains 'FYP')`,
    );
  });

  it('escapes quotes and backslashes', () => {
    expect(buildDocumentQuery({ nameContains: "Ammar's notes" })).toBe(
      `${BASE} and (name contains 'Ammar\\'s notes')`,
    );
    expect(buildDocumentQuery({ nameContains: 'C:\\docs' })).toBe(
      `${BASE} and (name contains 'C:\\\\docs')`,
    );
  });

  it.each([
    "x' or trashed=true or name contains '",
    "' or mimeType != '",
    'trailing backslash \\',
    "\\' or '1'='1",
    "') or (trashed=true",
  ])('cannot be broken out of by %j', (attack) => {
    const query = buildDocumentQuery({ nameContains: attack, fullTextContains: attack });
    const { skeleton, literals } = tokenize(query);
    // The query structure is unchanged, and the input survives verbatim as a single literal.
    expect(skeleton).toBe(
      "mimeType='' and trashed=false and (name contains '' or fullText contains '')",
    );
    expect(literals).toEqual([GOOGLE_DOCS_MIME_TYPE, attack, attack]);
  });
});

describe('field masks', () => {
  it('requests only the fields needed for summaries', () => {
    expect(DOCUMENT_FILE_FIELDS.split(',')).toEqual(
      expect.arrayContaining(['id', 'name', 'mimeType', 'createdTime', 'modifiedTime', 'trashed']),
    );
    expect(DOCUMENT_LIST_FIELDS).toBe(`nextPageToken,files(${DOCUMENT_FILE_FIELDS})`);
  });
});

describe('toDocumentSummary', () => {
  it('maps a Drive file to a document summary with a Docs URL', () => {
    expect(
      toDocumentSummary({
        id: DOC_ID,
        name: 'FYP Proposal',
        mimeType: GOOGLE_DOCS_MIME_TYPE,
        createdTime: '2026-01-01T10:00:00.000Z',
        modifiedTime: '2026-02-01T10:00:00.000Z',
        webViewLink: 'https://docs.google.com/document/d/x/edit?usp=drivesdk',
      }),
    ).toEqual({
      documentId: DOC_ID,
      name: 'FYP Proposal',
      url: `https://docs.google.com/document/d/${DOC_ID}/edit`,
      createdTime: '2026-01-01T10:00:00.000Z',
      modifiedTime: '2026-02-01T10:00:00.000Z',
    });
  });

  it('fills missing fields with safe defaults', () => {
    expect(toDocumentSummary({ id: DOC_ID })).toEqual({
      documentId: DOC_ID,
      name: '',
      url: `https://docs.google.com/document/d/${DOC_ID}/edit`,
      createdTime: null,
      modifiedTime: null,
    });
    expect(toDocumentSummary({ name: 'x', createdTime: null })).toMatchObject({
      documentId: '',
      createdTime: null,
    });
  });
});
