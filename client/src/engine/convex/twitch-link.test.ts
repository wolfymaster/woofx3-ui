import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// Linking under the Convex gateway is Twitch's OAuth redirect: Convex mints
// the authorize URL and the page leaves for it. These check the link the
// gateway reads from the platform-link rows, and what starting and unlinking
// send.

const actions: Array<{ name: string; args: unknown }> = [];
let actionResult: () => Promise<unknown> = () => Promise.resolve(null);

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    actions.push({ name: getFunctionName(action), args });
    return actionResult();
  },
}));

const { convexTwitchLinkGateway, nextRedirectLinking, twitchLinkOf } = await import("./twitch-link");

const instanceId = TEST_INSTANCE_ID;

const twitchRow = {
  _id: "link-1",
  _creationTime: 1,
  instanceId,
  platform: "twitch",
  platformUserId: "u-1",
  platformUsername: "wolfy",
  profileImageUrl: "https://img.example/wolfy.png",
  channelId: "u-1",
  expiresAt: 5,
  scopes: ["chat:read"],
  connectedByUserId: "user-1",
  authFailedAt: undefined,
  viewerCanRelink: true,
};

beforeEach(() => {
  actions.length = 0;
  actionResult = () => Promise.resolve(null);
});

describe("twitchLinkOf", () => {
  const cases: Array<{ name: string; rows: unknown[]; expected: unknown }> = [
    {
      name: "the Twitch row becomes the link, with no tokens or Convex fields",
      rows: [twitchRow],
      expected: {
        platformUserId: "u-1",
        platformUsername: "wolfy",
        profileImageUrl: "https://img.example/wolfy.png",
        scopes: ["chat:read"],
        authFailedAt: undefined,
        viewerCanRelink: true,
      },
    },
    {
      name: "a refused token keeps when Twitch refused it",
      rows: [{ ...twitchRow, authFailedAt: 42, profileImageUrl: undefined, viewerCanRelink: false }],
      expected: {
        platformUserId: "u-1",
        platformUsername: "wolfy",
        profileImageUrl: undefined,
        scopes: ["chat:read"],
        authFailedAt: 42,
        viewerCanRelink: false,
      },
    },
    {
      name: "another platform's row is not a Twitch link",
      rows: [{ ...twitchRow, platform: "youtube" }],
      expected: null,
    },
    { name: "no rows is no link", rows: [], expected: null },
  ];

  for (const { name, rows, expected } of cases) {
    test(name, () => {
      expect(twitchLinkOf(rows as Parameters<typeof twitchLinkOf>[0])).toEqual(expected);
    });
  }
});

describe("twitchLink.useLinkFlow", () => {
  test("starts idle", () => {
    const flow = renderInScope(() => convexTwitchLinkGateway.useLinkFlow());
    expect(flow.linking).toEqual({ status: "idle" });
  });

  test("asks Convex for the authorize URL with the page to come back to", async () => {
    actionResult = () => Promise.reject(new Error("Only an owner or admin can connect Twitch"));
    const flow = renderInScope(() => convexTwitchLinkGateway.useLinkFlow());
    flow.start({ returnTo: "/admin/integrations" });
    await Promise.resolve();
    expect(actions).toEqual([
      { name: "twitchIntegration:startConnect", args: { instanceId, redirectTo: "/admin/integrations" } },
    ]);
  });
});

describe("twitchLink.useUnlinkRequest", () => {
  test("removes the instance's Twitch link", async () => {
    const unlink = renderInScope(() => convexTwitchLinkGateway.useUnlinkRequest());
    await unlink();
    expect(actions).toEqual([{ name: "twitchIntegration:disconnect", args: { instanceId, platform: "twitch" } }]);
  });
});

describe("nextRedirectLinking", () => {
  type Linking = Parameters<typeof nextRedirectLinking>[0];
  type LinkingEvent = Parameters<typeof nextRedirectLinking>[1];
  const idle: Linking = { status: "idle" };
  const starting: Linking = { status: "starting" };
  const redirecting: Linking = { status: "redirecting" };
  const failed: Linking = { status: "failed", error: "Only an owner or admin can connect Twitch" };

  const cases: Array<{ name: string; current: Linking; event: LinkingEvent; expected: Linking }> = [
    { name: "starting from idle", current: idle, event: { type: "start" }, expected: starting },
    { name: "starting again after a failure", current: failed, event: { type: "start" }, expected: starting },
    { name: "a start while starting changes nothing", current: starting, event: { type: "start" }, expected: starting },
    {
      name: "a start while redirecting changes nothing",
      current: redirecting,
      event: { type: "start" },
      expected: redirecting,
    },
    {
      name: "the authorize URL arriving starts the redirect",
      current: starting,
      event: { type: "authorizeUrlReady" },
      expected: redirecting,
    },
    {
      name: "a refusal fails with its text",
      current: starting,
      event: { type: "refused", error: new Error("Only an owner or admin can connect Twitch") },
      expected: failed,
    },
    {
      name: "a refusal that is not an Error fails with it as text",
      current: starting,
      event: { type: "refused", error: "offline" },
      expected: { status: "failed", error: "offline" },
    },
    { name: "cancelling returns to idle", current: failed, event: { type: "cancel" }, expected: idle },
  ];

  for (const { name, current, event, expected } of cases) {
    test(name, () => {
      expect(nextRedirectLinking(current, event)).toEqual(expected);
    });
  }
});
