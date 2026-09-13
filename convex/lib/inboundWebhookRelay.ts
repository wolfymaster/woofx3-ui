import type { InboundWebhookRequest, InboundWebhookResponse } from "@woofx3/api";

/** Largest request body forwarded to the engine. */
export const MAX_INBOUND_BODY_BYTES = 256 * 1024;
/** Largest response body relayed back to the third party. */
export const MAX_RELAYED_BODY_BYTES = 64 * 1024;

/** Statuses whose response may not carry a body. */
const BODILESS_STATUSES = new Set([204, 205, 304]);

/**
 * The request as the engine's `handleInboundWebhook` receives it: header
 * names lowercased with `cookie` dropped (a server-to-server webhook never
 * needs it), one value per query key (the first), and the body decoded as
 * UTF-8.
 */
export function buildForwardedRequest(
  request: Request,
  url: URL,
  body: ArrayBuffer,
  deliveryId: string
): InboundWebhookRequest {
  if (request.method !== "GET" && request.method !== "POST") {
    throw new Error(`inbound webhook routes only accept GET and POST, got ${request.method}`);
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower !== "cookie") {
      headers[lower] = value;
    }
  });
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (!(key in query)) {
      query[key] = value;
    }
  });
  return {
    deliveryId,
    method: request.method,
    headers,
    query,
    rawBody: new TextDecoder().decode(body),
  };
}

/**
 * Turn the engine's answer into the response the third party gets. The
 * engine already validated the handler's result; anything that would still
 * be unsafe to send — a status outside 200-599, a header other than
 * content-type or x-*, an oversized body — becomes a 502 instead.
 */
export function toHttpResponse(engine: InboundWebhookResponse): Response {
  if (!Number.isInteger(engine.status) || engine.status < 200 || engine.status > 599) {
    return new Response(null, { status: 502 });
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(engine.headers)) {
    const lower = name.toLowerCase();
    if (lower !== "content-type" && !lower.startsWith("x-")) {
      return new Response(null, { status: 502 });
    }
    headers.set(lower, value);
  }
  if (new TextEncoder().encode(engine.body).byteLength > MAX_RELAYED_BODY_BYTES) {
    return new Response(null, { status: 502 });
  }
  const body = engine.body === "" || BODILESS_STATUSES.has(engine.status) ? null : engine.body;
  return new Response(body, { status: engine.status, headers });
}

/** The engine did not answer within the guard. */
export class EngineTimeoutError extends Error {
  constructor(ms: number) {
    super(`engine did not answer within ${ms}ms`);
    this.name = "EngineTimeoutError";
  }
}

/** Race `promise` against a timer that rejects with EngineTimeoutError. */
export async function withEngineTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new EngineTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
