import { describe, expect, it } from "bun:test";
import { parseInboundWebhookPath } from "./inboundWebhookPath";

const ENDPOINT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("parseInboundWebhookPath", () => {
  it("returns the endpoint id of a single-segment uuid path", () => {
    expect(parseInboundWebhookPath(`/api/webhooks/${ENDPOINT_ID}`)).toEqual({ ok: true, endpointId: ENDPOINT_ID });
  });

  it("lowercases an uppercase id so lookups match the stored form", () => {
    expect(parseInboundWebhookPath(`/api/webhooks/${ENDPOINT_ID.toUpperCase()}`)).toEqual({
      ok: true,
      endpointId: ENDPOINT_ID,
    });
  });

  it("rejects the engine callback paths", () => {
    expect(parseInboundWebhookPath("/api/webhooks/woofx3")).toEqual({ ok: false });
    expect(parseInboundWebhookPath("/api/webhooks/woofx3/alerts")).toEqual({ ok: false });
  });

  it("rejects a missing id, extra segments, a trailing slash, or a malformed id", () => {
    for (const path of [
      "/api/webhooks/",
      `/api/webhooks/${ENDPOINT_ID}/extra`,
      `/api/webhooks/${ENDPOINT_ID}/`,
      "/api/webhooks/not-a-uuid",
      `/api/webhooks/${ENDPOINT_ID.slice(0, -1)}`,
    ]) {
      expect(parseInboundWebhookPath(path)).toEqual({ ok: false });
    }
  });
});
