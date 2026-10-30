import { afterEach, describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { TwitchLinking } from "@/engine/types";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { nextDeviceLinking, toTwitchLink } from "./map/twitch-link";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { directTwitchLinkGateway } from "./twitch-link";

const harnesses: DirectHarness[] = [];

async function connected(prepare: (harness: DirectHarness) => void = () => {}): Promise<DirectHarness> {
  const harness = createDirectHarness();
  harnesses.push(harness);
  prepare(harness);
  await harness.connect();
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

const LINKED = {
  linked: true as const,
  revision: 3,
  userId: "42",
  login: "woofer",
  displayName: "Woofer",
  profileImageUrl: null,
  scopes: ["chat:read"],
  expiresAt: null,
  authFailedAt: null,
};

describe("toTwitchLink", () => {
  test("no link is null, and a link the streamer may always replace", () => {
    expect(toTwitchLink({ linked: false, revision: 1 })).toBeNull();
    expect(toTwitchLink(LINKED)).toEqual({
      platformUserId: "42",
      platformUsername: "woofer",
      profileImageUrl: undefined,
      scopes: ["chat:read"],
      authFailedAt: undefined,
      viewerCanRelink: true,
    });
  });

  test("falls back to the display name, then the id, when Helix gave no login", () => {
    expect(toTwitchLink({ ...LINKED, login: null })?.platformUsername).toBe("Woofer");
    expect(toTwitchLink({ ...LINKED, login: null, displayName: null })?.platformUsername).toBe("42");
  });
});

describe("nextDeviceLinking", () => {
  const awaiting: TwitchLinking = {
    status: "awaitingApproval",
    userCode: "C",
    verificationUri: "u",
    expiresAt: 0,
  };
  const ended = (status: "linked" | "expired" | "denied" | "failed" | "pending", reason?: string) => ({
    type: "ended" as const,
    state: { loginId: "l", status, expiresAt: "", ...(reason ? { reason } : {}) },
  });

  test.each([
    [{ status: "idle" } as TwitchLinking, { type: "start" as const }, { status: "starting" }],
    [awaiting, { type: "start" as const }, awaiting],
    [awaiting, ended("linked"), { status: "idle" }],
    [awaiting, ended("pending"), awaiting],
    [awaiting, ended("expired"), { status: "failed", error: expect.stringContaining("expired") }],
    [awaiting, ended("denied"), { status: "failed", error: "Twitch access was not approved." }],
    [awaiting, ended("failed", "bad token"), { status: "failed", error: "Twitch refused the link: bad token" }],
    [awaiting, { type: "cancel" as const }, { status: "idle" }],
  ])("%j on %j", (current, event, next) => {
    expect(nextDeviceLinking(current, event)).toEqual(next as TwitchLinking);
  });
});

describe("twitchLink", () => {
  test("the link is the engine's, and unlinking drops its token", async () => {
    const { runtime, state } = await connected((harness) => {
      harness.state.twitchLink = LINKED;
    });
    const twitch = directTwitchLinkGateway(runtime);
    const link = renderDirect(() => twitch.useLink());
    expect((await link.until((value) => value !== undefined, "the link"))?.platformUsername).toBe("woofer");

    await renderDirect(() => twitch.useUnlinkRequest()).current()();
    expect(state.callsOf("deleteTwitchToken")).toHaveLength(1);
    await link.until((value) => value === null, "no link");
    link.unmount();
  });

  test("a device login shows its code, follows the engine, and ends once linked", async () => {
    const { runtime, state, clock } = await connected();
    const flow = renderDirect(() => directTwitchLinkGateway(runtime).useLinkFlow());
    flow.current().start({ returnTo: "/" });
    const awaiting = await flow.until((value) => value.linking.status === "awaitingApproval", "the code");
    expect(awaiting.linking).toEqual({
      status: "awaitingApproval",
      userCode: "WOOF-1234",
      verificationUri: "https://www.twitch.tv/activate",
      expiresAt: Date.parse("2026-10-29T12:00:00.000Z"),
    });

    clock.advance(runtime.config.deviceLoginPollMs);
    await waitFor(() => state.callsOf("getTwitchDeviceLogin").length === 1, "the first poll");
    expect(flow.current().linking.status).toBe("awaitingApproval");
    state.deviceLogins["login-1"] = { loginId: "login-1", status: "linked", expiresAt: "" };
    await waitFor(() => {
      clock.advance(runtime.config.deviceLoginPollMs);
      return flow.current().linking.status === "idle";
    }, "linked");
    expect(state.callsOf("cancelTwitchDeviceLogin")).toHaveLength(0);
    flow.unmount();
    expect(state.callsOf("cancelTwitchDeviceLogin")).toHaveLength(0);
  });

  test("cancelling or leaving the screen cancels the engine's login", async () => {
    const { runtime, state } = await connected();
    const flow = renderDirect(() => directTwitchLinkGateway(runtime).useLinkFlow());
    flow.current().start({ returnTo: "/" });
    await flow.until((value) => value.linking.status === "awaitingApproval", "the code");
    flow.current().cancel();
    await flow.until((value) => value.linking.status === "idle", "idle");
    await waitFor(() => state.callsOf("cancelTwitchDeviceLogin").length === 1, "the engine told");

    flow.current().start({ returnTo: "/" });
    await flow.until((value) => value.linking.status === "awaitingApproval", "a second code");
    flow.unmount();
    await waitFor(() => state.callsOf("cancelTwitchDeviceLogin").length === 2, "the engine told on unmount");
  });

  test("an engine without a Twitch app, or without device login, fails with a reason", async () => {
    const { runtime } = await connected((harness) => {
      harness.state.deviceLoginStart = { ok: false, code: "not_configured", error: "no client id" };
    });
    const flow = renderDirect(() => directTwitchLinkGateway(runtime).useLinkFlow());
    flow.current().start({ returnTo: "/" });
    expect((await flow.until((value) => value.linking.status === "failed", "failed")).linking).toEqual({
      status: "failed",
      error: "This engine has no Twitch app to link with.",
    });

    const old = await connected((harness) => {
      harness.engine.capabilities = harness.engine.capabilities.filter(
        (capability) => capability !== ENGINE_CAPABILITIES.twitchDeviceLogin
      );
    });
    const oldFlow = renderDirect(() => directTwitchLinkGateway(old.runtime).useLinkFlow());
    oldFlow.current().start({ returnTo: "/" });
    expect((await oldFlow.until((value) => value.linking.status === "failed", "failed")).linking).toMatchObject({
      error: expect.stringContaining("Update the engine"),
    });
  });
});
