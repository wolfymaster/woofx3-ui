import { describe, expect, test } from "bun:test";
import { newBackend } from "./lib/convexTest.testing";
import { INBOUND_WEBHOOK_BURST } from "./lib/inboundWebhookLimits";

const ENDPOINT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** An enabled endpoint whose instance has no engine credentials, so a delivery answers 503 without any network. */
async function backendWithEndpoint(endpointId: string) {
  const t = newBackend();
  await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("webhookEndpoints", {
      instanceId,
      endpointId,
      triggerKey: "mod:trigger:t",
      modulePrefix: "mod",
      triggerManifestId: "t",
      isEnabled: true,
      createdAt: 1,
    });
  });
  return t;
}

describe("inbound webhook rate limit", () => {
  test("answers 429 once an endpoint's burst is spent, and leaves other endpoints alone", async () => {
    const otherId = "1f8fad5b-d9cb-469f-a165-70867728950e";
    const t = await backendWithEndpoint(ENDPOINT_ID);
    await t.run(async (ctx) => {
      const instance = await ctx.db.query("instances").first();
      await ctx.db.insert("webhookEndpoints", {
        instanceId: instance?._id as never,
        endpointId: otherId,
        triggerKey: "mod:trigger:u",
        modulePrefix: "mod",
        triggerManifestId: "u",
        isEnabled: true,
        createdAt: 1,
      });
    });
    const post = (id: string) => t.fetch(`/api/webhooks/${id}`, { method: "POST", body: "{}" });

    // Shards may refuse early, never late: no more than the burst gets through.
    const statuses: number[] = [];
    for (let i = 0; i < INBOUND_WEBHOOK_BURST + 10; i++) {
      const response = await post(ENDPOINT_ID);
      statuses.push(response.status);
      if (response.status === 429) {
        expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      }
    }

    expect(statuses.filter((status) => status === 503).length).toBeLessThanOrEqual(INBOUND_WEBHOOK_BURST);
    expect(statuses.every((status) => status === 503 || status === 429)).toBe(true);
    expect(statuses).toContain(429);
    expect((await post(otherId)).status).toBe(503);
  });
});
