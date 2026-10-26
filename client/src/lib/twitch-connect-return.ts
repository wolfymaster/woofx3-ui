// A Twitch connect that saved the link but did not reach the engine comes back
// to the app with this marker on the address, so the integrations card can
// offer a retry after the page has reloaded.

const ENGINE_PENDING_PARAM = "twitch_engine";
const ENGINE_PENDING_VALUE = "pending";

/** `path` with the marker added; `path` is a same-site path that may already carry a query. */
export function withEnginePending(path: string): string {
  const url = new URL(path, "http://app.invalid");
  url.searchParams.set(ENGINE_PENDING_PARAM, ENGINE_PENDING_VALUE);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Whether `search` (a `location.search`) carries the marker. */
export function hasEnginePending(search: string): boolean {
  return new URLSearchParams(search).get(ENGINE_PENDING_PARAM) === ENGINE_PENDING_VALUE;
}

/** `search` without the marker, for rewriting the address once the engine has the link. */
export function withoutEnginePending(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(ENGINE_PENDING_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
