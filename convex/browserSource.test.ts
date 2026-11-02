import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import { fixture } from "./lib/userPages.fixtures";

describe("overlayFacts", () => {
  test("gives the overlay's key to an admin, and only the facts to a member", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const sceneId = await ctx.db.insert("scenes", { instanceId: f.instanceId, name: "Scene", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("browserSourceKeys", {
        instanceId: f.instanceId,
        sceneId,
        key: "secret-key",
        name: "Scene Browser Source",
        purpose: "obs",
        createdAt: 1,
      });
    });

    const args = { instanceId: f.instanceId };
    expect((await f.owner.query(api.browserSource.overlayFacts, args))?.featuredKey).toBe("secret-key");
    const asMember = await f.member.query(api.browserSource.overlayFacts, args);
    expect(asMember?.featuredKey).toBeNull();
    expect(asMember?.browserSourceKeyCount).toBe(1);
  });
});
