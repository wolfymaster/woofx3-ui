import { afterEach, describe, expect, test } from "bun:test";
import { starterItemKey } from "@shared/starter-packs";
import type { GroupSnapshot, UISetting, WorkflowDefinition } from "@woofx3/api";
import { directKeys } from "./keys";
import { directStarterPacksGateway, starterPackStates } from "./starter-packs";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { UI_SETTING_NAMESPACES } from "./ui-settings";

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

const NONE = { workflowIds: new Set<string>(), commandIds: new Set<string>(), commandNames: new Set<string>() };

function ledgerSetting(key: string, kind: "workflow" | "command", engineId: string): UISetting {
  return {
    namespace: UI_SETTING_NAMESPACES.starterPacks,
    key,
    value: { kind, engineId },
    revision: 1,
    updatedAt: "2026-10-31T10:00:00Z",
    deleted: false,
  };
}

const SOCIALS = starterItemKey("handy-commands", "socials");
const LURK = starterItemKey("handy-commands", "lurk");

describe("starterPackStates", () => {
  test("an item is installed while the object its ledger entry names exists", () => {
    const settings = [ledgerSetting(SOCIALS, "command", "c-1")];
    expect(starterPackStates(settings, { ...NONE, commandIds: new Set(["c-1"]) })[SOCIALS]).toBe("installed");
    expect(starterPackStates(settings, NONE)[SOCIALS]).toBe("available");
  });

  test("a command whose name is taken by another command is a conflict, whatever its case", () => {
    expect(starterPackStates([], { ...NONE, commandNames: new Set(["lurk"]) })[LURK]).toBe("conflict");
  });

  test("a ledger entry of another shape is ignored", () => {
    const entry = { ...ledgerSetting(SOCIALS, "command", "c-1"), value: "c-1" };
    expect(starterPackStates([entry], { ...NONE, commandIds: new Set(["c-1"]) })[SOCIALS]).toBe("available");
  });
});

describe("starterPacks", () => {
  const moderator: GroupSnapshot = {
    id: "g-1",
    name: "moderator",
    description: "",
    createdAt: "2026-10-31T10:00:00Z",
    isBuiltIn: true,
  };

  function withChatReply(state: DirectHarness["state"]): void {
    state.workflowCatalog = {
      triggers: [],
      actions: [
        {
          id: "chat.reply",
          name: "Reply",
          description: "",
          projectionKey: "woofx3:action:chat.reply",
          type: "function",
          call: "chat.reply",
          createdByType: "SYSTEM",
          createdByRef: "",
        },
      ],
      functions: [],
    } as never;
    state.groups = [moderator];
  }

  test("installing a pack creates its commands, records them, and installing again changes nothing", async () => {
    const { runtime, state } = await connected();
    withChatReply(state);
    const packs = directStarterPacksGateway(runtime);
    const status = renderDirect(() => packs.useStatus());
    await status.until((value) => value !== undefined, "the status");
    expect(status.current()?.[SOCIALS]).toBe("available");
    const install = renderDirect(() => packs.useInstallRequest()).current();

    const results = await install({ packId: "handy-commands", values: {} });
    expect(results.map((result) => [result.itemId, result.outcome])).toEqual([
      ["socials", "installed"],
      ["lurk", "installed"],
    ]);
    expect(state.commands.map((command) => command.command)).toEqual(["socials", "lurk"]);
    expect(state.callsOf("setUISetting").map(([, key]) => key)).toEqual([SOCIALS, LURK]);
    await status.until((value) => value?.[SOCIALS] === "installed", "the installed status");

    const again = await install({ packId: "handy-commands", values: {} });
    expect(again.map((result) => result.outcome)).toEqual(["already-installed", "already-installed"]);
    expect(state.commands).toHaveLength(2);
    status.unmount();
  });

  test("a command name the streamer already has is a conflict and is left alone", async () => {
    const { runtime, state } = await connected();
    withChatReply(state);
    state.commands = [
      {
        id: "c-own",
        command: "lurk",
        actions: [],
        workflowId: "",
        steps: [],
        workflowError: "",
        cooldown: 0,
        priority: 0,
        enabled: true,
        visibility: "public",
        groupIds: [],
        usernames: [],
        argumentPattern: "",
      },
    ];
    const install = renderDirect(() => directStarterPacksGateway(runtime).useInstallRequest()).current();

    const results = await install({ packId: "handy-commands", values: {} });

    expect(results.map((result) => [result.itemId, result.outcome])).toEqual([
      ["socials", "installed"],
      ["lurk", "conflict"],
    ]);
  });

  test("an item whose action the engine lacks is unavailable, and nothing is created for it", async () => {
    const { runtime, state } = await connected();
    const install = renderDirect(() => directStarterPacksGateway(runtime).useInstallRequest()).current();

    const results = await install({ packId: "handy-commands", values: {} });

    expect(results.map((result) => result.outcome)).toEqual(["unavailable", "unavailable"]);
    expect(state.commands).toEqual([]);
    expect(runtime.queryClient.getQueryData(directKeys.commands.list())).toBeUndefined();
  });

  function withCheerCatalog(state: DirectHarness["state"]): void {
    state.workflowCatalog = {
      triggers: [
        {
          id: "cheer",
          name: "Cheer",
          event: "channel.cheer",
          projectionKey: "woofx3:trigger:channel.cheer",
          type: "event",
          createdByType: "SYSTEM",
          createdByRef: "",
        },
      ],
      actions: [
        {
          id: "chat.reply",
          name: "Reply",
          projectionKey: "woofx3:action:chat.reply",
          type: "function",
          call: "chat.reply",
          createdByType: "SYSTEM",
          createdByRef: "",
        },
      ],
      functions: [],
    } as never;
  }

  function cheerWorkflow(id: string, name: string, isEnabled = true) {
    const definition = {
      id,
      name,
      trigger: {
        type: "event",
        event: "channel.cheer",
        order: 0,
        conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
      },
      tasks: [{ id: "existing-step", type: "action", action: "chat.reply" }],
    } as unknown as WorkflowDefinition;
    return {
      id,
      name,
      description: "",
      isEnabled,
      definition,
      stats: { runsToday: 0, successRate: 0 },
      createdAt: "2026-10-28T10:00:00Z",
      updatedAt: "2026-10-28T10:00:00Z",
    };
  }

  test("a workflow item extends a matching trigger instead of creating another", async () => {
    const { runtime, state } = await connected();
    withCheerCatalog(state);
    state.workflows = [cheerWorkflow("workflow-existing", "My cheer alert") as never];
    const install = renderDirect(() => directStarterPacksGateway(runtime).useInstallRequest()).current();

    const results = await install({ packId: "cheer-thanks", values: {} });

    expect(results.map((result) => result.outcome)).toEqual(["installed"]);
    expect(state.workflows).toHaveLength(1);
    expect(state.callsOf("createWorkflow")).toHaveLength(0);
    const appended = state.workflows[0].definition as WorkflowDefinition;
    expect(appended.name).toBe("My cheer alert");
    expect(appended.tasks.map((task) => task.id)).toEqual(["existing-step", "thank-cheerer"]);
    expect(appended.tasks[1].dependsOn).toEqual(["existing-step"]);
    expect(state.callsOf("setUISetting").map(([, key]) => key)).toEqual([
      starterItemKey("cheer-thanks", "cheer-thanks"),
    ]);

    const again = await install({ packId: "cheer-thanks", values: {} });
    expect(again.map((result) => result.outcome)).toEqual(["already-installed"]);
    expect(state.callsOf("updateWorkflow")).toHaveLength(1);
  });

  test("paused and module workflows are never extended", async () => {
    for (const [name, isEnabled] of [
      ["Paused cheer alert", false],
      ["twitch/cheer alert", true],
    ] as const) {
      const { runtime, state } = await connected();
      withCheerCatalog(state);
      state.workflows = [cheerWorkflow("workflow-existing", name, isEnabled) as never];
      const install = renderDirect(() => directStarterPacksGateway(runtime).useInstallRequest()).current();

      const results = await install({ packId: "cheer-thanks", values: {} });

      expect(results.map((result) => result.outcome)).toEqual(["installed"]);
      expect(state.workflows).toHaveLength(2);
      expect(state.callsOf("createWorkflow")).toHaveLength(1);
      expect(state.callsOf("updateWorkflow")).toHaveLength(0);
    }
  });

  test("an unknown pack and a value the pack refuses reject", async () => {
    const { runtime, state } = await connected();
    withChatReply(state);
    const install = renderDirect(() => directStarterPacksGateway(runtime).useInstallRequest()).current();

    await expect(install({ packId: "nope", values: {} })).rejects.toThrow('Unknown starter pack "nope"');
    await expect(install({ packId: "handy-commands", values: { socialsMessage: "" } })).rejects.toThrow();
  });
});
