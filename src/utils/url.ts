/** Builds the canonical edit URL for a Google Docs document ID returned by Google. */
export function documentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`;
}
