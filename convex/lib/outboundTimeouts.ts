/**
 * Deadlines for calls from Convex to other services. A peer that accepts the
 * connection and then says nothing would otherwise hold the action (and, on
 * callback routes, the browser waiting on it) until the platform kills it.
 */
export const OUTBOUND_FETCH_TIMEOUT_MS = 10_000;
/** For downloads of whole module archives. */
export const OUTBOUND_ARCHIVE_TIMEOUT_MS = 30_000;
