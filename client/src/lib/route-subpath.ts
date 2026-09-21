/**
 * The path below a page's own route, as decoded segments.
 *
 * Taken from the location rather than a route's `*` param, because that param is not
 * the page's alone: wouter's `Route` merges its parent's params into its own
 * (`{ ...useParams(), ...routeParams }`), and a `<Route>` with no path matches as `*`.
 * Every screen here renders inside such a pathless route — the one holding AuthGuard
 * and the app shell — so its `*` is the whole location, and a page whose own route
 * declares no wildcard inherits it: at `/stream/alerts`, `params["*"]` reads
 * `"stream/alerts"` rather than nothing.
 */
export function subPathSegments(location: string, basePath: string): string[] {
  const prefix = `${basePath}/`;
  if (!location.startsWith(prefix)) {
    return [];
  }
  return location.slice(prefix.length).split("/").filter(Boolean).map(decodeSegment);
}

/** A URL path segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
