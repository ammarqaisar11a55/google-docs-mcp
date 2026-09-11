import type { DocsClient } from '../google/docs-client.js';
import type { DriveClient } from '../google/drive-client.js';
import { ContentService } from './content-service.js';
import { DocumentsService } from './documents-service.js';
import { FormattingService } from './formatting-service.js';
import { SearchService } from './search-service.js';
import { StructureService } from './structure-service.js';

/** Business-logic layer used by MCP tools, resources and prompts. */
export interface Services {
  documents: DocumentsService;
  content: ContentService;
  formatting: FormattingService;
  structure: StructureService;
  search: SearchService;
}

export function createServices(docs: DocsClient, drive: DriveClient): Services {
  return {
    documents: new DocumentsService(docs, drive),
    content: new ContentService(docs),
    formatting: new FormattingService(docs),
    structure: new StructureService(docs),
    search: new SearchService(docs, drive),
  };
}
