import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_MODERATION_CONFIG, type ModerationConfig } from "@woofx3/api/moderation-config";
import type { ModerationActionRecord } from "@/engine/types";
import { directChatModerationGateway } from "./chat-moderation";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";

const harnesses: DirectHarness[] = [];

async function connected(): Promise<DirectHarness> {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

const LINKS_ON: ModerationConfig = {
  ...DEFAULT_MODERATION_CONFIG,
  enabled: true,
  rules: {
    links: {
      enabled: true,
      actions: [{ kind: "delete" }],
      params: { allowDomains: ["example.tv"], permitSeconds: 60 },
    },
  },
};

const ACTION: ModerationActionRecord = {
  id: "ce-1",
  time: "2026-11-04T10:00:00.000Z",
  platform: "twitch",
  viewer: "v-1",
  chatterLogin: "viewer_one",
  messageId: "m-1",
  filter: "links",
  reason: "posted a link to a website not on the list",
  text: "go to evil.com",
  dryRun: false,
  steps: [{ kind: "delete", outcome: "done" }],
};

describe("chat moderation, direct", () => {
  test("reads the engine's config, saves one and reads it back", async () => {
    const harness = await connected();
    const gateway = directChatModerationGateway(harness.runtime);
    const hook = renderDirect(() => ({
      read: gateway.useConfigRequest(),
      save: gateway.useSetConfigRequest(),
    }));
    expect(await hook.current().read()).toEqual({ kind: "ready", config: DEFAULT_MODERATION_CONFIG });
    expect(await hook.current().save(LINKS_ON)).toEqual(LINKS_ON);
    expect(await hook.current().read()).toEqual({ kind: "ready", config: LINKS_ON });
    expect(harness.state.callsOf("setModerationConfig")).toEqual([[LINKS_ON]]);
    hook.unmount();
  });

  test("a save the engine refuses rejects with its problem and changes nothing", async () => {
    const harness = await connected();
    const save = renderDirect(() => directChatModerationGateway(harness.runtime).useSetConfigRequest());
    const broken = { ...LINKS_ON, rules: { links: { ...LINKS_ON.rules.links, actions: [] } } } as ModerationConfig;
    await expect(save.current()(broken)).rejects.toThrow("must list at least one action");
    expect(harness.state.moderationConfig).toEqual(DEFAULT_MODERATION_CONFIG);
    save.unmount();
  });

  test("lists the recent actions, 50 unless asked for fewer", async () => {
    const harness = await connected();
    harness.state.moderationActions = [ACTION];
    const list = renderDirect(() => directChatModerationGateway(harness.runtime).useRecentActionsRequest());
    expect(await list.current()()).toEqual([ACTION]);
    expect(await list.current()(10)).toEqual([ACTION]);
    expect(harness.state.callsOf("listModerationActions")).toEqual([[50], [10]]);
    list.unmount();
  });
});
