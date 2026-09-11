/**
 * Retry policy for Google API calls. Gaxios only retries idempotent HTTP methods by default
 * (GET/HEAD/PUT/OPTIONS/DELETE), so non-idempotent writes such as batchUpdate are never replayed.
 */
export const RETRY_CONFIG = {
  retry: 3,
  noResponseRetries: 2,
  statusCodesToRetry: [
    [429, 429],
    [500, 599],
  ],
};
