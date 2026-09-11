import { z } from 'zod';

/** Largest index accepted in inputs (Google Docs bodies are far smaller than this). */
export const MAX_DOCUMENT_INDEX = 10_000_000;

export const documentIdSchema = z
  .string()
  .min(1)
  .max(500)
  .describe(
    'The Google Docs document ID (the part between /d/ and /edit in the document URL). A full Google Docs URL is also accepted.',
  );

export const indexSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_DOCUMENT_INDEX)
  .describe(
    'A Google Docs index (UTF-16 offset). The body starts at index 1. Get exact indexes from get_document (structure) or find_text.',
  );

export const startIndexSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_DOCUMENT_INDEX)
  .describe('Start of the range (inclusive). Get exact indexes from get_document or find_text.');

export const endIndexSchema = z
  .number()
  .int()
  .min(2)
  .max(MAX_DOCUMENT_INDEX)
  .describe('End of the range (exclusive); must be greater than startIndex.');
