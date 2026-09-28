import { describe, expect, test } from "bun:test";
import { isMarkerRequestPending, MARKER_REQUEST_WINDOW_MS } from "./goLiveMarker";

const NOW = 10_000_000_000;

describe("isMarkerRequestPending", () => {
  test("no request is nothing to drop", () => {
    expect(isMarkerRequestPending(undefined, NOW)).toBe(false);
  });

  test("a request made before going live is still honoured inside the window", () => {
    expect(isMarkerRequestPending(NOW - MARKER_REQUEST_WINDOW_MS, NOW)).toBe(true);
  });

  test("a request older than the window belongs to a stream that never started", () => {
    expect(isMarkerRequestPending(NOW - MARKER_REQUEST_WINDOW_MS - 1, NOW)).toBe(false);
  });
});
