import { describe, expect, test } from "bun:test";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { ActionNode, TriggerNode } from "@/lib/workflow-tree";
import { actionNodeLabel, triggerNodeLabel } from "./workflow-node-label";

function catalogTrigger(overrides: Partial<CatalogTriggerRow>): CatalogTriggerRow {
  return {
    id: "t1",
    name: "Channel Point Redemption",
    description: "",
    category: "twitch",
    color: "",
    icon: "Zap",
    event: "redeem.channelpoints.twitch",
    ...overrides,
  };
}

function catalogAction(overrides: Partial<CatalogActionRow>): CatalogActionRow {
  return {
    id: "a1",
    name: "Send Chat Message",
    description: "",
    category: "twitch",
    color: "",
    icon: "MessageSquare",
    handlerType: "function",
    functionCall: "twitch.chat.send",
    ...overrides,
  };
}

describe("triggerNodeLabel", () => {
  test("matches by canonicalRef", () => {
    const node: TriggerNode = {
      type: "trigger",
      id: "__trigger",
      event: "redeem.channelpoints.twitch",
      conditions: [],
      ref: "twitch_platform:trigger:redeem.channelpoints",
    };
    const catalog = [catalogTrigger({ canonicalRef: "twitch_platform:trigger:redeem.channelpoints" })];
    expect(triggerNodeLabel(node, catalog)).toBe("Channel Point Redemption");
  });

  test("matches chat-command style event by base prefix", () => {
    const node: TriggerNode = {
      type: "trigger",
      id: "__trigger",
      event: "chat.command.hug",
      conditions: [],
    };
    const catalog = [catalogTrigger({ event: "chat.command", name: "Chat Command" })];
    expect(triggerNodeLabel(node, catalog)).toBe("Chat Command");
  });

  test("falls back to raw event when no catalog match", () => {
    const node: TriggerNode = { type: "trigger", id: "__trigger", event: "unknown.event", conditions: [] };
    expect(triggerNodeLabel(node, [])).toBe("unknown.event");
  });
});

describe("actionNodeLabel", () => {
  test("matches by canonicalRef over functionCall", () => {
    const node: ActionNode = {
      type: "action",
      id: "a1",
      action: "function",
      parameters: {},
      ref: "twitch_platform:action:chat.send",
      function: "twitch.chat.send",
    };
    const catalog = [catalogAction({ canonicalRef: "twitch_platform:action:chat.send" })];
    expect(actionNodeLabel(node, catalog)).toBe("Send Chat Message");
  });

  test("matches by functionCall when no ref", () => {
    const node: ActionNode = {
      type: "action",
      id: "a1",
      action: "function",
      parameters: {},
      function: "twitch.chat.send",
    };
    const catalog = [catalogAction({})];
    expect(actionNodeLabel(node, catalog)).toBe("Send Chat Message");
  });

  test("does not guess when handler type is ambiguous", () => {
    const node: ActionNode = { type: "action", id: "a1", action: "function", parameters: {} };
    const catalog = [
      catalogAction({ id: "a1", name: "Send Chat Message", functionCall: "twitch.chat.send" }),
      catalogAction({ id: "a2", name: "Play Sound", functionCall: "barkloader.play" }),
    ];
    expect(actionNodeLabel(node, catalog)).toBe("function");
  });

  test("falls back to raw handler type when no catalog match", () => {
    const node: ActionNode = { type: "action", id: "a1", action: "http", parameters: {} };
    expect(actionNodeLabel(node, [])).toBe("http");
  });
});
