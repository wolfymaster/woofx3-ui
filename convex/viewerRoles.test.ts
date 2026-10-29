import { describe, expect, test } from "bun:test";
import type { Id } from "./_generated/dataModel";
import { VIEWER_ROLES_TTL_MS } from "./lib/viewerAuth";
import { fakeViewerCtx } from "./lib/viewerDb.fakes";
import { expireViewerRoles, recordViewerRoleRefresh } from "./viewerRoles";

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

describe("cached roles expiry", () => {
  const checked = (checkedAt: number) =>
    ({ kind: "checked", follower: true, subscriberTier: null, checkedAt }) as const;

  test("a stored check schedules its own deletion at the end of its lifetime", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(fake.ctx, { viewerId: VIEWER, channel: { ...CHANNEL, result: checked(NOW) } }, NOW);
    const [row] = fake.tables.get("viewerRoles") ?? [];
    expect(fake.scheduled).toEqual([{ at: NOW + VIEWER_ROLES_TTL_MS, args: { id: row?._id, checkedAt: NOW } }]);
  });

  test("an outage schedules nothing", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { ...CHANNEL, result: { kind: "unavailable", failedAt: NOW } } },
      NOW
    );
    expect(fake.scheduled).toEqual([]);
  });

  test("deletes the roles the expiring check recorded", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(fake.ctx, { viewerId: VIEWER, channel: { ...CHANNEL, result: checked(NOW) } }, NOW);
    const [expiry] = fake.scheduled;
    await expireViewerRoles(fake.ctx, expiry?.args as Parameters<typeof expireViewerRoles>[1]);
    expect(fake.tables.get("viewerRoles")).toEqual([]);
  });

  test("leaves roles checked again since the expiring check", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(fake.ctx, { viewerId: VIEWER, channel: { ...CHANNEL, result: checked(NOW) } }, NOW);
    const later = NOW + VIEWER_ROLES_TTL_MS + 1;
    await recordViewerRoleRefresh(
      fake.ctx,
      { viewerId: VIEWER, channel: { ...CHANNEL, result: checked(later) } },
      later
    );
    const [first, second] = fake.scheduled;
    await expireViewerRoles(fake.ctx, first?.args as Parameters<typeof expireViewerRoles>[1]);
    expect(fake.tables.get("viewerRoles")).toMatchObject([{ checkedAt: later }]);
    await expireViewerRoles(fake.ctx, second?.args as Parameters<typeof expireViewerRoles>[1]);
    expect(fake.tables.get("viewerRoles")).toEqual([]);
  });

  test("expiring roles that are already gone succeeds", async () => {
    const fake = fakeViewerCtx();
    await recordViewerRoleRefresh(fake.ctx, { viewerId: VIEWER, channel: { ...CHANNEL, result: checked(NOW) } }, NOW);
    const [expiry] = fake.scheduled;
    const args = expiry?.args as Parameters<typeof expireViewerRoles>[1];
    await expireViewerRoles(fake.ctx, args);
    await expireViewerRoles(fake.ctx, args);
    expect(fake.tables.get("viewerRoles")).toEqual([]);
  });
});
