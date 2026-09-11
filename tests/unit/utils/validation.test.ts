import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';
import {
  assertInsertIndex,
  assertRange,
  assertSafeUrl,
  escapeDriveQueryValue,
  normalizeDocumentId,
  parseHexColor,
} from '../../../src/utils/validation.js';
import { DOC_ID } from '../../helpers/fakes.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  throw new Error('Expected the function to throw an AppError.');
}

describe('normalizeDocumentId', () => {
  it('accepts a raw document ID (trimming whitespace)', () => {
    expect(normalizeDocumentId(DOC_ID)).toBe(DOC_ID);
    expect(normalizeDocumentId(`  ${DOC_ID}\n`)).toBe(DOC_ID);
  });

  it('extracts the ID from Google Docs URLs', () => {
    for (const url of [
      `https://docs.google.com/document/d/${DOC_ID}/edit`,
      `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`,
      `https://docs.google.com/document/d/${DOC_ID}/edit#heading=h.abc123`,
      `https://docs.google.com/document/d/${DOC_ID}`,
      `https://docs.google.com/document/u/0/d/${DOC_ID}/edit`,
      `https://docs.google.com/document/u/12/d/${DOC_ID}/view`,
    ]) {
      expect(normalizeDocumentId(url), url).toBe(DOC_ID);
    }
  });

  it.each([
    ['path traversal', '../../etc/passwd'],
    ['path traversal after an ID', `${DOC_ID}/../../drive/v3/files`],
    ['traversal inside a URL', 'https://docs.google.com/document/d/../../files/edit'],
    ['spaces', 'abc def ghi jkl mno'],
    ['query injection', `${DOC_ID}?fields=*`],
    ['parameter injection', `${DOC_ID}&alt=media`],
    ['encoded characters', `${DOC_ID}%2F..`],
    ['too short', 'abc123'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['too long', 'a'.repeat(201)],
    ['a spreadsheet URL', `https://docs.google.com/spreadsheets/d/x/edit`],
  ])('rejects %s', (_label, input) => {
    expect(codeOf(() => normalizeDocumentId(input))).toBe(ErrorCode.INVALID_DOCUMENT_ID);
  });
});

describe('assertInsertIndex', () => {
  it('accepts indexes from 1 to bodyEndIndex - 1', () => {
    expect(() => {
      assertInsertIndex(1, 12);
    }).not.toThrow();
    expect(() => {
      assertInsertIndex(11, 12);
    }).not.toThrow();
  });

  it('rejects indexes outside the body with details', () => {
    let caught: unknown;
    try {
      assertInsertIndex(12, 12);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorCode.INVALID_INDEX);
    expect((caught as AppError).details).toEqual({ index: 12, minIndex: 1, maxIndex: 11 });
    expect(
      codeOf(() => {
        assertInsertIndex(0, 12);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    expect(
      codeOf(() => {
        assertInsertIndex(-5, 12);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
  });

  it('only allows index 1 in an empty document (bodyEndIndex 2)', () => {
    expect(() => {
      assertInsertIndex(1, 2);
    }).not.toThrow();
    expect(
      codeOf(() => {
        assertInsertIndex(2, 2);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
  });

  it('rejects non-integer indexes', () => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        codeOf(() => {
          assertInsertIndex(value, 12);
        }),
      ).toBe(ErrorCode.INVALID_INDEX);
    }
  });
});

describe('assertRange', () => {
  const noNewline = { allowFinalNewline: false };
  const withNewline = { allowFinalNewline: true };

  it('accepts ranges inside the body', () => {
    expect(() => {
      assertRange(1, 11, 12, noNewline);
    }).not.toThrow();
    expect(() => {
      assertRange(5, 6, 12, noNewline);
    }).not.toThrow();
  });

  it('only includes the final newline when allowed', () => {
    expect(
      codeOf(() => {
        assertRange(1, 12, 12, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    expect(() => {
      assertRange(1, 12, 12, withNewline);
    }).not.toThrow();
    expect(
      codeOf(() => {
        assertRange(1, 13, 12, withNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
  });

  it('handles an empty document (bodyEndIndex 2)', () => {
    // Nothing can be deleted from an empty document...
    expect(
      codeOf(() => {
        assertRange(1, 2, 2, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    // ...but its single (empty) paragraph can be styled.
    expect(() => {
      assertRange(1, 2, 2, withNewline);
    }).not.toThrow();
  });

  it('rejects startIndex < 1, empty or reversed ranges and non-integers', () => {
    expect(
      codeOf(() => {
        assertRange(0, 5, 12, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    expect(
      codeOf(() => {
        assertRange(5, 5, 12, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    expect(
      codeOf(() => {
        assertRange(6, 5, 12, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    expect(
      codeOf(() => {
        assertRange(1.5, 5, 12, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
    expect(
      codeOf(() => {
        assertRange(1, 5.5, 12, noNewline);
      }),
    ).toBe(ErrorCode.INVALID_INDEX);
  });

  it('reports the maximum endIndex in details', () => {
    try {
      assertRange(1, 20, 12, noNewline);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).details).toEqual({ startIndex: 1, endIndex: 20, maxEndIndex: 11 });
    }
  });
});

describe('parseHexColor', () => {
  it('parses #RRGGBB into 0..1 channels', () => {
    expect(parseHexColor('#1A73E8')).toEqual({
      red: 0x1a / 255,
      green: 0x73 / 255,
      blue: 0xe8 / 255,
    });
    expect(parseHexColor('#000000')).toEqual({ red: 0, green: 0, blue: 0 });
  });

  it('parses #RGB shorthand, lowercase and a missing #', () => {
    expect(parseHexColor('#fff')).toEqual({ red: 1, green: 1, blue: 1 });
    expect(parseHexColor('#f00')).toEqual({ red: 1, green: 0, blue: 0 });
    expect(parseHexColor('ff0000')).toEqual({ red: 1, green: 0, blue: 0 });
    expect(parseHexColor(' #00FF00 ')).toEqual({ red: 0, green: 1, blue: 0 });
  });

  it.each(['red', '#12345', '#1234567', '#GGGGGG', '', 'rgb(0,0,0)'])('rejects %j', (value) => {
    expect(codeOf(() => parseHexColor(value))).toBe(ErrorCode.INVALID_ARGUMENT);
  });

  it('truncates long invalid values in the error message', () => {
    try {
      parseHexColor('x'.repeat(100));
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).message).not.toContain('x'.repeat(21));
    }
  });
});

describe('assertSafeUrl', () => {
  it('accepts http, https and mailto URLs', () => {
    expect(assertSafeUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
    expect(assertSafeUrl('http://example.com')).toBe('http://example.com/');
    expect(assertSafeUrl('  mailto:someone@example.com ')).toBe('mailto:someone@example.com');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'vbscript:msgbox',
  ])('rejects %s', (url) => {
    expect(codeOf(() => assertSafeUrl(url))).toBe(ErrorCode.INVALID_ARGUMENT);
  });

  it('rejects invalid URLs', () => {
    expect(codeOf(() => assertSafeUrl('not a url'))).toBe(ErrorCode.INVALID_ARGUMENT);
    expect(codeOf(() => assertSafeUrl('/relative/path'))).toBe(ErrorCode.INVALID_ARGUMENT);
  });
});

describe('escapeDriveQueryValue', () => {
  it('escapes single quotes and backslashes', () => {
    expect(escapeDriveQueryValue("it's")).toBe("it\\'s");
    expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b');
    // Backslashes are escaped first so an escaped quote cannot be un-escaped.
    expect(escapeDriveQueryValue("\\'")).toBe("\\\\\\'");
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeDriveQueryValue('FYP Proposal 2026')).toBe('FYP Proposal 2026');
  });
});
