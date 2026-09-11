/** A reference to a Google Doc, returned by tools that create or copy documents. */
export interface DocumentReference {
  documentId: string;
  title: string;
  url: string;
}

/** A Google Doc as listed by Google Drive. */
export interface DocumentSummary {
  documentId: string;
  name: string;
  url: string;
  createdTime: string | null;
  modifiedTime: string | null;
}

export interface DocumentPage {
  documents: DocumentSummary[];
  count: number;
  /** Pass to the next call as `pageToken` to fetch more results; null when there are no more. */
  nextPageToken: string | null;
}

/** Common result shape for tools that modify document content. */
export interface WriteResult {
  documentId: string;
  url: string;
  [key: string]: unknown;
}
