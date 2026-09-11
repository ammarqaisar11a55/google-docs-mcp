import { describe, expect, it } from 'vitest';
import { OBJECT_PLACEHOLDER, parseDocument } from '../../../src/google/document-parser.js';
import {
  extractRangeText,
  matchesExpectedText,
  previewText,
  sanitizeInsertText,
} from '../../../src/services/edit-helpers.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';
import { makeDocument } from '../../helpers/fakes.js';

const chr = (...codes: number[]) => String.fromCharCode(...codes);

describe('sanitizeInsertText', () => {
  it('converts CRLF and lone CR to paragraph breaks', () => {
    expect(sanitizeInsertText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('keeps tabs, newlines, vertical tabs and astral characters', () => {
    const text = `a\tb\nc${chr(0x0b)}d${chr(0xd83d, 0xde00)}`;
    expect(sanitizeInsertText(text)).toBe(text);
  });

  it('removes control and private-use characters that Google strips', () => {
    const text = `${chr(0)}a${chr(8)}b${chr(0x0c)}c${chr(0x1f)}d${chr(0xe000)}e${chr(0xf8ff)}`;
    expect(sanitizeInsertText(text)).toBe('abcde');
  });

  it('throws INVALID_ARGUMENT when nothing insertable remains', () => {
    expect(() => sanitizeInsertText(chr(1, 2, 3))).toThrow(AppError);
    try {
      sanitizeInsertText(chr(0xe001));
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCode.INVALID_ARGUMENT);
    }
  });
});

describe('extractRangeText', () => {
  // 'Intro\n' [1,7) | table [7,23): 'alpha\n' [10,16), 'beta\n' [17,22) | 'Outro\n' [23,29)
  const parsed = parseDocument(makeDocument(['Intro', { table: [['alpha', 'beta']] }, 'Outro']));

  it('returns text within a single paragraph', () => {
    expect(extractRangeText(parsed.paragraphs, { startIndex: 2, endIndex: 5 })).toBe('ntr');
  });

  it('includes paragraph breaks', () => {
    expect(extractRangeText(parsed.paragraphs, { startIndex: 1, endIndex: 7 })).toBe('Intro\n');
  });

  it('reads text inside table cells', () => {
    expect(extractRangeText(parsed.paragraphs, { startIndex: 10, endIndex: 15 })).toBe('alpha');
  });

  it('skips structural table markers when spanning a table', () => {
    expect(extractRangeText(parsed.paragraphs, { startIndex: 4, endIndex: 25 })).toBe(
      'ro\nalpha\nbeta\nOu',
    );
  });
});

describe('matchesExpectedText', () => {
  it('requires an exact, case-sensitive match', () => {
    expect(matchesExpectedText('Hello', 'Hello')).toBe(true);
    expect(matchesExpectedText('Hello', 'hello')).toBe(false);
    expect(matchesExpectedText('Hello\n', 'Hello')).toBe(false);
  });

  it('ignores inline-object placeholders', () => {
    expect(matchesExpectedText(`a${OBJECT_PLACEHOLDER}b`, 'ab')).toBe(true);
  });
});

describe('previewText', () => {
  it('truncates long text with an ellipsis', () => {
    expect(previewText('abcdef', 3)).toBe('abc…');
    expect(previewText('abc', 3)).toBe('abc');
  });
});
