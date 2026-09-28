/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
export function decodeRouteParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
