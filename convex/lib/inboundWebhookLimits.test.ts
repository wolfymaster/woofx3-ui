import { describe, expect, test } from "bun:test";
import { admitInboundWebhook, INBOUND_WEBHOOK_CONFLICT_RETRY_SECONDS } from "./inboundWebhookLimits";

const CONFLICT = new Error(
  'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
);

describe("admitInboundWebhook", () => {
  test("admits while the bucket has room", async () => {
    expect(await admitInboundWebhook(async () => ({ ok: true }))).toEqual({ ok: true });
  });

  test("refuses with the bucket's wait, rounded up to whole seconds", async () => {
    expect(await admitInboundWebhook(async () => ({ ok: false, retryAfter: 1500 }))).toEqual({
      ok: false,
      retryAfterSeconds: 2,
    });
  });

  test("a write conflict is refused as a retry, not thrown", async () => {
    expect(
      await admitInboundWebhook(async () => {
        throw CONFLICT;
      })
    ).toEqual({ ok: false, retryAfterSeconds: INBOUND_WEBHOOK_CONFLICT_RETRY_SECONDS });
  });

  test("any other error surfaces", async () => {
    await expect(
      admitInboundWebhook(async () => {
        throw new Error("component unavailable");
      })
    ).rejects.toThrow("component unavailable");
  });
});
