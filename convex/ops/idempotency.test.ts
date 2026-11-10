import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import { newBackend } from "../lib/convexTest.testing";
import { claimOpsRequest, OPS_REQUESTS, type OpsRequestId, settleOpsRequest } from "../lib/ops/idempotency";

type Backend = ReturnType<typeof newBackend>;

const ID: OpsRequestId = { write: "projection", accountId: "a", key: "key-projection-1" };

async function requests(t: Backend) {
  return t.run(async (ctx) => ctx.db.query("opsRequests").collect());
}

describe("claimOpsRequest", () => {
  test("a claim while the first is pending answers in_progress, and a stale claim is taken over", async () => {
    const t = newBackend();
    expect(await t.run((ctx) => claimOpsRequest(ctx, ID, "{}", Date.now()))).toEqual({ kind: "claimed" });
    expect(await t.run((ctx) => claimOpsRequest(ctx, ID, "{}", Date.now()))).toMatchObject({
      kind: "answered",
      outcome: { ok: false, status: 409, code: "in_progress" },
    });
    const later = Date.now() + OPS_REQUESTS.staleClaimMs + 1;
    expect(await t.run((ctx) => claimOpsRequest(ctx, ID, "{}", later))).toEqual({ kind: "claimed" });
  });

  test("a refusal releases the key, so the same request can be claimed again", async () => {
    const t = newBackend();
    await t.run((ctx) => claimOpsRequest(ctx, ID, "{}", Date.now()));
    await t.run((ctx) => settleOpsRequest(ctx, ID, { ok: false }, Date.now()));
    expect(await requests(t)).toEqual([]);
    expect(await t.run((ctx) => claimOpsRequest(ctx, ID, "{}", Date.now()))).toEqual({ kind: "claimed" });
  });

  test("a settled success is replayed, and the same key with another body is refused", async () => {
    const t = newBackend();
    await t.run((ctx) => claimOpsRequest(ctx, ID, '{"v":1}', Date.now()));
    await t.run((ctx) => settleOpsRequest(ctx, ID, { ok: true, result: { applied: true } }, Date.now()));
    expect(await t.run((ctx) => claimOpsRequest(ctx, ID, '{"v":1}', Date.now()))).toEqual({
      kind: "answered",
      outcome: { ok: true, result: { applied: true } },
    });
    expect(await t.run((ctx) => claimOpsRequest(ctx, ID, '{"v":2}', Date.now()))).toMatchObject({
      outcome: { ok: false, status: 409, code: "idempotency_mismatch" },
    });
  });
});

describe("cleanupOld", () => {
  test("deletes keys past retention and keeps recent ones", async () => {
    const t = newBackend();
    const row = {
      write: "projection" as const,
      accountId: "a",
      fingerprint: "{}",
      state: "done" as const,
      result: "{}",
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("opsRequests", {
        ...row,
        key: "old-key-1",
        claimedAt: Date.now() - OPS_REQUESTS.retentionMs - 1,
      });
      await ctx.db.insert("opsRequests", { ...row, key: "new-key-1", claimedAt: Date.now() });
    });
    expect(await t.mutation(internal.ops.requests.cleanupOld, {})).toBe(1);
    expect((await requests(t)).map((r) => r.key)).toEqual(["new-key-1"]);
  });
});
