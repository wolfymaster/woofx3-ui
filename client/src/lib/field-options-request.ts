/**
 * A stable string for what a field-options request asks for. Form fields are
 * parsed again on renders, so the object describing a request is new each
 * time even when nothing about it changed; keying the request on this string
 * rather than the object sends it once per distinct request instead of once
 * per keystroke in a sibling field. Object keys are sorted so the same request
 * built in a different key order gets the same key.
 */
export function fieldOptionsRequestKey(request: unknown): string {
  return JSON.stringify(request, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = (value as Record<string, unknown>)[key];
    }
    return sorted;
  });
}

/**
 * What to show when the dispatch action itself fails, so no reply will ever
 * arrive: the message a ConvexError carries in its data, else the error's own
 * message.
 */
export function dispatchErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string" && data !== "") {
      return data;
    }
    if (data !== null && typeof data === "object") {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message !== "") {
        return message;
      }
    }
  }
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }
  return "Request failed";
}
