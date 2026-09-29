export const STREAM_RECAPS_PATH = "/stream/recaps";
export const STREAM_RECAP_ROUTE = `${STREAM_RECAPS_PATH}/:sessionId`;

export function streamRecapPath(sessionId: string): string {
  return `${STREAM_RECAPS_PATH}/${encodeURIComponent(sessionId)}`;
}

/** The session id from a recap route segment; one that is not valid percent-encoding is kept as written. */
export function sessionIdFromParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
