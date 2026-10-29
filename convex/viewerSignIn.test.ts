import { describe, expect, test } from "bun:test";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { requireInstanceRole } from "./lib/instanceAccess";
import { generateOpaqueToken, hashOpaqueToken } from "./lib/oauthHandoff";
import { VIEWER_HANDOFF_TTL_MS, VIEWER_LOGIN_STATE_TTL_MS, VIEWER_SESSION_TTL_MS } from "./lib/viewerAuth";
import { type FakeViewerCtx, fakeViewerCtx, seed } from "./lib/viewerDb.fakes";
import { requireViewer, viewerFromSession } from "./lib/viewerSessionAuth";
import { consumeViewerLoginState } from "./viewerLogin";
import { redeemViewerHandoff } from "./viewerSession";

const NOW = 1_800_000_000_000;
const STATE_HASH = "c".repeat(64);

async function seedViewer(fake: FakeViewerCtx): Promise<Id<"viewers">> {
  return seed<Id<"viewers">>(fake, "viewers", {
    platform: "twitch",
    platformUserId: "V1",
    login: "viewer",
    displayName: "Viewer",
    updatedAt: NOW,
  });
}

/** A handoff waiting for the page, and the code and nonce the page holds for it. */
async function seedHandoff(fake: FakeViewerCtx, createdAt = NOW) {
  const viewerId = await seedViewer(fake);
  const code = generateOpaqueToken();
  const nonce = generateOpaqueToken();
  await seed(fake, "viewerHandoffs", {
    codeHash: await hashOpaqueToken(code),
    viewerId,
    origin: "https://woofx3.tv",
    nonceHash: await hashOpaqueToken(nonce),
    createdAt,
  });
  return { viewerId, code, nonce };
}

async function redeem(fake: FakeViewerCtx, code: string, nonce: string, now = NOW) {
  const sessionToken = generateOpaqueToken();
  const result = await redeemViewerHandoff(
    fake.ctx,
    {
      codeHash: await hashOpaqueToken(code),
      nonceHash: await hashOpaqueToken(nonce),
      sessionTokenHash: await hashOpaqueToken(sessionToken),
    },
    now
  );
  return { result, sessionToken };
}

describe("login state", () => {
  const login = {
    stateHash: STATE_HASH,
    platform: "twitch",
    returnOrigin: "https://woofx3.tv",
    returnPath: "/u/wolfy",
    nonceHash: "d".repeat(64),
  };

  test("is consumed once; a replayed callback is refused", async () => {
    const fake = fakeViewerCtx();
    await seed(fake, "viewerLoginStates", { ...login, createdAt: NOW });
    expect(await consumeViewerLoginState(fake.ctx, STATE_HASH, NOW)).toEqual({
      platform: "twitch",
      returnOrigin: "https://woofx3.tv",
      returnPath: "/u/wolfy",
      nonceHash: login.nonceHash,
    });
    expect(await consumeViewerLoginState(fake.ctx, STATE_HASH, NOW)).toBeNull();
  });

  test("an expired state is refused and deleted", async () => {
    const fake = fakeViewerCtx();
    await seed(fake, "viewerLoginStates", { ...login, createdAt: NOW - VIEWER_LOGIN_STATE_TTL_MS - 1 });
    expect(await consumeViewerLoginState(fake.ctx, STATE_HASH, NOW)).toBeNull();
    expect(fake.tables.get("viewerLoginStates")).toEqual([]);
  });
});

describe("handoff exchange", () => {
  test("opens a session for the viewer, expiring after the session TTL", async () => {
    const fake = fakeViewerCtx();
    const { viewerId, code, nonce } = await seedHandoff(fake);
    const { result, sessionToken } = await redeem(fake, code, nonce);
    expect(result).toEqual({ ok: true, expiresAt: NOW + VIEWER_SESSION_TTL_MS });
    expect((await requireViewer(fake.ctx, sessionToken))._id).toBe(viewerId);
    expect(fake.scheduled.map((job) => job.at)).toEqual([NOW + VIEWER_SESSION_TTL_MS]);
  });

  test("a replayed handoff code is refused", async () => {
    const fake = fakeViewerCtx();
    const { code, nonce } = await seedHandoff(fake);
    expect((await redeem(fake, code, nonce)).result.ok).toBe(true);
    const replay = await redeem(fake, code, nonce);
    expect(replay.result).toEqual({ ok: false, error: "handoff_invalid" });
    expect(await viewerFromSession(fake.ctx, replay.sessionToken)).toBeNull();
    expect(fake.tables.get("viewerSessions")).toHaveLength(1);
  });

  test("a handoff presented with another nonce is refused and burned", async () => {
    const fake = fakeViewerCtx();
    const { code, nonce } = await seedHandoff(fake);
    expect((await redeem(fake, code, generateOpaqueToken())).result).toEqual({ ok: false, error: "nonce_mismatch" });
    expect((await redeem(fake, code, nonce)).result).toEqual({ ok: false, error: "handoff_invalid" });
  });

  test("an expired handoff is refused", async () => {
    const fake = fakeViewerCtx();
    const { code, nonce } = await seedHandoff(fake, NOW - VIEWER_HANDOFF_TTL_MS - 1);
    expect((await redeem(fake, code, nonce)).result).toEqual({ ok: false, error: "handoff_expired" });
    expect(fake.tables.get("viewerSessions") ?? []).toEqual([]);
  });
});

describe("sessions", () => {
  test("an expired session, whose row expiry deleted, signs nobody in", async () => {
    const fake = fakeViewerCtx();
    const { code, nonce } = await seedHandoff(fake);
    const { sessionToken } = await redeem(fake, code, nonce);
    const [session] = fake.tables.get("viewerSessions") ?? [];
    await fake.ctx.db.delete(session._id as Id<"viewerSessions">);
    expect(await viewerFromSession(fake.ctx, sessionToken)).toBeNull();
    await expect(requireViewer(fake.ctx, sessionToken)).rejects.toThrow("Not signed in");
  });

  test("a token that is not one this deployment issues is refused without a lookup", async () => {
    const fake = fakeViewerCtx();
    expect(await viewerFromSession(fake.ctx, "header.claims.signature")).toBeNull();
    expect(await viewerFromSession(fake.ctx, null)).toBeNull();
  });
});

describe("a viewer session is not a dashboard session", () => {
  test("a signed-in viewer is nobody to Convex Auth", async () => {
    const fake = fakeViewerCtx();
    const { code, nonce } = await seedHandoff(fake);
    const { sessionToken } = await redeem(fake, code, nonce);
    expect(await requireViewer(fake.ctx, sessionToken)).toBeTruthy();

    expect(await getAuthUserId(fake.ctx)).toBeNull();
    await expect(requireInstanceRole(fake.ctx, "instances:1" as Id<"instances">)).rejects.toThrow("Not authenticated");
  });

  test("a dashboard identity does not sign anyone in as a viewer", async () => {
    const fake = fakeViewerCtx();
    fake.identity = { subject: "users:1|authSessions:1" };
    expect(await viewerFromSession(fake.ctx, generateOpaqueToken())).toBeNull();
  });
});
