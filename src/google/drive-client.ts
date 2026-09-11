import { drive, type drive_v3 } from '@googleapis/drive';
import type { OAuth2Client } from 'google-auth-library';
import type { AuthorizedClientProvider } from '../auth/google-auth.js';
import { RETRY_CONFIG } from './retry.js';

export type DriveFile = drive_v3.Schema$File;

export interface ListFilesParams {
  q: string;
  pageSize: number;
  fields: string;
  pageToken?: string | undefined;
  orderBy?: string | undefined;
}

export interface ListFilesResult {
  files: DriveFile[];
  nextPageToken: string | undefined;
}

/** Thin, mockable wrapper around the Google Drive API. Contains no business logic. */
export interface DriveClient {
  listFiles(params: ListFilesParams): Promise<ListFilesResult>;
  getFile(fileId: string, fields: string): Promise<DriveFile>;
  copyFile(fileId: string, name: string, fields: string): Promise<DriveFile>;
  /** Moves a file to the Drive trash (recoverable). Never permanently deletes. */
  trashFile(fileId: string, fields: string): Promise<DriveFile>;
}

export class GoogleDriveClient implements DriveClient {
  private cached: { auth: OAuth2Client; api: drive_v3.Drive } | undefined;

  constructor(private readonly auth: AuthorizedClientProvider) {}

  private async api(): Promise<drive_v3.Drive> {
    const auth = await this.auth.getAuthorizedClient();
    if (this.cached?.auth !== auth) {
      this.cached = { auth, api: drive({ version: 'v3', auth, retryConfig: RETRY_CONFIG }) };
    }
    return this.cached.api;
  }

  async listFiles(params: ListFilesParams): Promise<ListFilesResult> {
    const api = await this.api();
    const response = await api.files.list({
      q: params.q,
      pageSize: params.pageSize,
      fields: params.fields,
      ...(params.pageToken ? { pageToken: params.pageToken } : {}),
      ...(params.orderBy ? { orderBy: params.orderBy } : {}),
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return {
      files: response.data.files ?? [],
      nextPageToken: response.data.nextPageToken ?? undefined,
    };
  }

  async getFile(fileId: string, fields: string): Promise<DriveFile> {
    const api = await this.api();
    const response = await api.files.get({ fileId, fields, supportsAllDrives: true });
    return response.data;
  }

  async copyFile(fileId: string, name: string, fields: string): Promise<DriveFile> {
    const api = await this.api();
    const response = await api.files.copy({
      fileId,
      fields,
      supportsAllDrives: true,
      requestBody: { name },
    });
    return response.data;
  }

  async trashFile(fileId: string, fields: string): Promise<DriveFile> {
    const api = await this.api();
    const response = await api.files.update({
      fileId,
      fields,
      supportsAllDrives: true,
      requestBody: { trashed: true },
    });
    return response.data;
  }
}
