import { describe, expect, it } from "bun:test";
import {
  buildForwardedRequest,
  EngineTimeoutError,
  MAX_RELAYED_BODY_BYTES,
  toHttpResponse,
  withEngineTimeout,
} from "./inboundWebhookRelay";

const URL_STRING = "https://example.convex.site/api/webhooks/0f8fad5b-d9cb-469f-a165-70867728950e?a=1&a=2&b=x";

function body(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("buildForwardedRequest", () => {
  it("lowercases header names, drops cookie, and keeps the first query value", () => {
    const request = new Request(URL_STRING, {
      method: "POST",
      headers: { "X-Signature": "sha256=abc", Cookie: "session=1", "Content-Type": "application/json" },
    });
    const forwarded = buildForwardedRequest(request, new URL(URL_STRING), body('{"id":1}'), "delivery-1");

    expect(forwarded).toEqual({
      deliveryId: "delivery-1",
      method: "POST",
      headers: { "x-signature": "sha256=abc", "content-type": "application/json" },
      query: { a: "1", b: "x" },
      rawBody: '{"id":1}',
    });
  });

  it("forwards a GET with an empty body", () => {
    const request = new Request(URL_STRING, { method: "GET" });
    const forwarded = buildForwardedRequest(request, new URL(URL_STRING), new ArrayBuffer(0), "delivery-2");

    expect(forwarded.method).toBe("GET");
    expect(forwarded.rawBody).toBe("");
  });

  it("refuses any other method", () => {
    const request = new Request(URL_STRING, { method: "PUT" });
    expect(() => buildForwardedRequest(request, new URL(URL_STRING), new ArrayBuffer(0), "d")).toThrow("PUT");
  });
});

describe("toHttpResponse", () => {
  it("relays the engine's status, allowed headers, and body", async () => {
    const response = toHttpResponse({
      status: 200,
      headers: { "content-type": "application/json", "x-delivery": "d-1" },
      body: '{"pong":true}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-delivery")).toBe("d-1");
    expect(await response.text()).toBe('{"pong":true}');
  });

  it("sends no body for an empty one or a status that cannot carry one", async () => {
    expect(await toHttpResponse({ status: 401, headers: {}, body: "" }).text()).toBe("");
    expect(toHttpResponse({ status: 204, headers: {}, body: "ignored" }).status).toBe(204);
  });

  it("answers 502 for a status, header, or body the engine should never have sent", () => {
    expect(toHttpResponse({ status: 700, headers: {}, body: "" }).status).toBe(502);
    expect(toHttpResponse({ status: 200, headers: { "set-cookie": "a=b" }, body: "" }).status).toBe(502);
    expect(toHttpResponse({ status: 200, headers: {}, body: "a".repeat(MAX_RELAYED_BODY_BYTES + 1) }).status).toBe(502);
  });
});

describe("withEngineTimeout", () => {
  it("passes a prompt answer through", async () => {
    expect(await withEngineTimeout(Promise.resolve("ok"), 1_000)).toBe("ok");
  });

  it("rejects with EngineTimeoutError when the engine is too slow", async () => {
    const never = new Promise<string>(() => {});
    await expect(withEngineTimeout(never, 5)).rejects.toBeInstanceOf(EngineTimeoutError);
  });
});
