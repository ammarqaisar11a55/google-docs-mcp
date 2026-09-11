import type { docs_v1 } from '@googleapis/docs';
import type { DocsClient } from '../google/docs-client.js';
import type { WriteResult } from '../types/documents.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { documentUrl } from '../utils/url.js';
import { assertRange, parseHexColor } from '../utils/validation.js';
import { batchUpdateAt, type IndexRange, loadDocumentBounds } from './edit-helpers.js';

export const NAMED_STYLE_TYPES = [
  'NORMAL_TEXT',
  'TITLE',
  'SUBTITLE',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'HEADING_4',
  'HEADING_5',
  'HEADING_6',
] as const;
export type NamedStyleType = (typeof NAMED_STYLE_TYPES)[number];

export const ALIGNMENTS = ['START', 'CENTER', 'END', 'JUSTIFIED'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** Character formatting to apply. Properties left undefined are not changed. */
export interface TextStyleInput {
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  underline?: boolean | undefined;
  strikethrough?: boolean | undefined;
  /** Font size in points. */
  fontSize?: number | undefined;
  fontFamily?: string | undefined;
  /** Hex color such as `#1A73E8`. */
  foregroundColor?: string | undefined;
  /** Hex color such as `#FFFF00`. */
  backgroundColor?: string | undefined;
}

export interface TextStyleUpdate {
  textStyle: docs_v1.Schema$TextStyle;
  /** Field mask entries, one per property that was specified. */
  fields: string[];
}

const BOOLEAN_STYLE_KEYS = ['bold', 'italic', 'underline', 'strikethrough'] as const;

/**
 * Converts formatting input into an `updateTextStyle` payload containing only the specified
 * properties, so everything else keeps its current formatting.
 */
export function buildTextStyle(input: TextStyleInput): TextStyleUpdate {
  const textStyle: docs_v1.Schema$TextStyle = {};
  const fields: string[] = [];

  for (const key of BOOLEAN_STYLE_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      textStyle[key] = value;
      fields.push(key);
    }
  }
  if (input.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: input.fontSize, unit: 'PT' };
    fields.push('fontSize');
  }
  if (input.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: input.fontFamily };
    fields.push('weightedFontFamily');
  }
  if (input.foregroundColor !== undefined) {
    textStyle.foregroundColor = { color: { rgbColor: parseHexColor(input.foregroundColor) } };
    fields.push('foregroundColor');
  }
  if (input.backgroundColor !== undefined) {
    textStyle.backgroundColor = { color: { rgbColor: parseHexColor(input.backgroundColor) } };
    fields.push('backgroundColor');
  }

  if (fields.length === 0) {
    throw new AppError(
      ErrorCode.INVALID_ARGUMENT,
      'Specify at least one formatting property: bold, italic, underline, strikethrough, fontSize, fontFamily, foregroundColor or backgroundColor.',
    );
  }
  return { textStyle, fields };
}

export interface FormatTextResult extends WriteResult {
  startIndex: number;
  endIndex: number;
  /** The text style properties that were changed. */
  updatedFields: string[];
}

export interface ParagraphStyleResult extends WriteResult {
  startIndex: number;
  endIndex: number;
  style: NamedStyleType;
}

export interface AlignmentResult extends WriteResult {
  startIndex: number;
  endIndex: number;
  alignment: Alignment;
}

/** Character and paragraph formatting. None of these operations change text or indexes. */
export class FormattingService {
  constructor(private readonly docs: DocsClient) {}

  async formatText(
    documentIdOrUrl: string,
    range: IndexRange,
    style: TextStyleInput,
  ): Promise<FormatTextResult> {
    // Validate the style before any network call.
    const { textStyle, fields } = buildTextStyle(style);
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertRange(range.startIndex, range.endIndex, bounds.bodyEndIndex, { allowFinalNewline: true });
    await batchUpdateAt(this.docs, bounds, [
      { updateTextStyle: { range: { ...range }, textStyle, fields: fields.join(',') } },
    ]);
    return {
      documentId: bounds.documentId,
      url: documentUrl(bounds.documentId),
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      updatedFields: fields,
    };
  }

  async setParagraphStyle(
    documentIdOrUrl: string,
    range: IndexRange,
    style: NamedStyleType,
  ): Promise<ParagraphStyleResult> {
    const documentId = await this.updateParagraphStyle(
      documentIdOrUrl,
      range,
      { namedStyleType: style },
      'namedStyleType',
    );
    return { documentId, url: documentUrl(documentId), ...range, style };
  }

  async setAlignment(
    documentIdOrUrl: string,
    range: IndexRange,
    alignment: Alignment,
  ): Promise<AlignmentResult> {
    const documentId = await this.updateParagraphStyle(
      documentIdOrUrl,
      range,
      { alignment },
      'alignment',
    );
    return { documentId, url: documentUrl(documentId), ...range, alignment };
  }

  /** Applies `paragraphStyle` to every paragraph overlapping the range; returns the document ID. */
  private async updateParagraphStyle(
    documentIdOrUrl: string,
    range: IndexRange,
    paragraphStyle: docs_v1.Schema$ParagraphStyle,
    fields: string,
  ): Promise<string> {
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertRange(range.startIndex, range.endIndex, bounds.bodyEndIndex, { allowFinalNewline: true });
    await batchUpdateAt(this.docs, bounds, [
      { updateParagraphStyle: { range: { ...range }, paragraphStyle, fields } },
    ]);
    return bounds.documentId;
  }
}
