import { describe, expect, test } from "bun:test";
import type { Id } from "./_generated/dataModel";
import { fakeViewerCtx } from "./lib/viewerDb.fakes";
import { recordViewerRoleRefresh } from "./viewerRoles";

const NOW = 1_800_000_000_000;
const VIEWER = "viewers:1" as Id<"viewers">;
const CHANNEL = { platform: "twitch" as const, broadcasterPlatformUserId: "B1" };

describe("recordViewerRoleRefresh", () => {
  test("remembers when the platform could not answer, moving the time forward on a repeat", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { ...CHANNEL, result: { kind: "unavailable", failedAt: NOW } } },
      NOW
    );
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { ...CHANNEL, result: { kind: "unavailable", failedAt: NOW + 5 } } },
      NOW + 5
    );
    expect(fake.tables.get("viewerRoleOutages")).toMatchObject([{ viewerId: VIEWER, ...CHANNEL, failedAt: NOW + 5 }]);
    expect(fake.tables.get("viewerRoles") ?? []).toEqual([]);
  });

  test("a successful check stores the roles and ends the outage", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { ...CHANNEL, result: { kind: "unavailable", failedAt: NOW } } },
      NOW
    );
    const checked = { kind: "checked" as const, follower: true, subscriberTier: 3 as const, checkedAt: NOW + 1 };
    await recordViewerRoleRefresh(fake.ctx, { viewerId: VIEWER, channel: { ...CHANNEL, result: checked } }, NOW + 1);
    expect(fake.tables.get("viewerRoleOutages")).toEqual([]);
    expect(fake.tables.get("viewerRoles")).toMatchObject([
      { viewerId: VIEWER, ...CHANNEL, follower: true, subscriberTier: 3, checkedAt: NOW + 1 },
    ]);
  });

  test("an outage on one channel does not touch another", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { ...CHANNEL, result: { kind: "unavailable", failedAt: NOW } } },
      NOW
    );
    const checked = { kind: "checked" as const, follower: false, subscriberTier: null, checkedAt: NOW };
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { platform: "twitch", broadcasterPlatformUserId: "B2", result: checked } },
      NOW
    );
    expect(fake.tables.get("viewerRoleOutages")).toHaveLength(1);
  });
});
