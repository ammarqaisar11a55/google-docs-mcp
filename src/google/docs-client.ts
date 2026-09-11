import { docs, type docs_v1 } from '@googleapis/docs';
import type { OAuth2Client } from 'google-auth-library';
import type { AuthorizedClientProvider } from '../auth/google-auth.js';
import { RETRY_CONFIG } from './retry.js';

export type GoogleDocument = docs_v1.Schema$Document;
export type DocsRequest = docs_v1.Schema$Request;
export type DocsBatchUpdateResponse = docs_v1.Schema$BatchUpdateDocumentResponse;

export interface BatchUpdateOptions {
  /**
   * Revision the request indexes were computed against. Google transforms the requests over
   * any collaborator edits made since then, so indexes stay correct.
   */
  targetRevisionId?: string | undefined;
}

/** Thin, mockable wrapper around the Google Docs API. Contains no business logic. */
export interface DocsClient {
  getDocument(documentId: string, fields?: string): Promise<GoogleDocument>;
  createDocument(title: string): Promise<GoogleDocument>;
  batchUpdate(
    documentId: string,
    requests: DocsRequest[],
    options?: BatchUpdateOptions,
  ): Promise<DocsBatchUpdateResponse>;
}

export class GoogleDocsClient implements DocsClient {
  private cached: { auth: OAuth2Client; api: docs_v1.Docs } | undefined;

  constructor(private readonly auth: AuthorizedClientProvider) {}

  private async api(): Promise<docs_v1.Docs> {
    const auth = await this.auth.getAuthorizedClient();
    if (this.cached?.auth !== auth) {
      this.cached = { auth, api: docs({ version: 'v1', auth, retryConfig: RETRY_CONFIG }) };
    }
    return this.cached.api;
  }

  async getDocument(documentId: string, fields?: string): Promise<GoogleDocument> {
    const api = await this.api();
    const response = await api.documents.get({ documentId, ...(fields ? { fields } : {}) });
    return response.data;
  }

  async createDocument(title: string): Promise<GoogleDocument> {
    const api = await this.api();
    const response = await api.documents.create({ requestBody: { title } });
    return response.data;
  }

  async batchUpdate(
    documentId: string,
    requests: DocsRequest[],
    options: BatchUpdateOptions = {},
  ): Promise<DocsBatchUpdateResponse> {
    const api = await this.api();
    const response = await api.documents.batchUpdate({
      documentId,
      requestBody: {
        requests,
        ...(options.targetRevisionId
          ? { writeControl: { targetRevisionId: options.targetRevisionId } }
          : {}),
      },
    });
    return response.data;
  }
}
