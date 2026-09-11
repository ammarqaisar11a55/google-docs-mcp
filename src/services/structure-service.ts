import type { DocsClient } from '../google/docs-client.js';
import type { WriteResult } from '../types/documents.js';
import { documentUrl } from '../utils/url.js';
import { assertInsertIndex, assertRange, assertSafeUrl } from '../utils/validation.js';
import { batchUpdateAt, type IndexRange, loadDocumentBounds } from './edit-helpers.js';

export const LIST_TYPES = ['bulleted', 'numbered', 'checkbox'] as const;
export type ListType = (typeof LIST_TYPES)[number];

/** Google Docs bullet presets used for each list type. */
export const BULLET_PRESETS: Record<ListType, string> = {
  bulleted: 'BULLET_DISC_CIRCLE_SQUARE',
  numbered: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
  checkbox: 'BULLET_CHECKBOX',
};

export interface PageBreakResult extends WriteResult {
  index: number;
}

export interface InsertTableResult extends WriteResult {
  index: number;
  /** Google inserts a paragraph break before the table, so the table starts at index + 1. */
  tableStartIndex: number;
  rows: number;
  columns: number;
}

export interface InsertLinkResult extends WriteResult {
  startIndex: number;
  endIndex: number;
  linkUrl: string;
}

export interface CreateListResult extends WriteResult {
  startIndex: number;
  endIndex: number;
  listType: ListType;
  bulletPreset: string;
}

/** Structural elements: page breaks, tables, links and lists. */
export class StructureService {
  constructor(private readonly docs: DocsClient) {}

  async insertPageBreak(documentIdOrUrl: string, index: number): Promise<PageBreakResult> {
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertInsertIndex(index, bounds.bodyEndIndex);
    await batchUpdateAt(this.docs, bounds, [{ insertPageBreak: { location: { index } } }]);
    return { documentId: bounds.documentId, url: documentUrl(bounds.documentId), index };
  }

  async insertTable(
    documentIdOrUrl: string,
    index: number,
    rows: number,
    columns: number,
  ): Promise<InsertTableResult> {
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertInsertIndex(index, bounds.bodyEndIndex);
    await batchUpdateAt(this.docs, bounds, [
      { insertTable: { rows, columns, location: { index } } },
    ]);
    return {
      documentId: bounds.documentId,
      url: documentUrl(bounds.documentId),
      index,
      tableStartIndex: index + 1,
      rows,
      columns,
    };
  }

  async insertLink(
    documentIdOrUrl: string,
    range: IndexRange,
    url: string,
  ): Promise<InsertLinkResult> {
    const linkUrl = assertSafeUrl(url);
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertRange(range.startIndex, range.endIndex, bounds.bodyEndIndex, {
      allowFinalNewline: false,
    });
    await batchUpdateAt(this.docs, bounds, [
      {
        updateTextStyle: {
          range: { ...range },
          textStyle: { link: { url: linkUrl } },
          fields: 'link',
        },
      },
    ]);
    return {
      documentId: bounds.documentId,
      url: documentUrl(bounds.documentId),
      ...range,
      linkUrl,
    };
  }

  async createList(
    documentIdOrUrl: string,
    range: IndexRange,
    listType: ListType,
  ): Promise<CreateListResult> {
    const bulletPreset = BULLET_PRESETS[listType];
    const bounds = await loadDocumentBounds(this.docs, documentIdOrUrl);
    assertRange(range.startIndex, range.endIndex, bounds.bodyEndIndex, { allowFinalNewline: true });
    await batchUpdateAt(this.docs, bounds, [
      { createParagraphBullets: { range: { ...range }, bulletPreset } },
    ]);
    return {
      documentId: bounds.documentId,
      url: documentUrl(bounds.documentId),
      ...range,
      listType,
      bulletPreset,
    };
  }
}
