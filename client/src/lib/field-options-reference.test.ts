import { describe, expect, test } from "bun:test";
import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  fieldOptionsOwnerFromCanonicalId,
  fieldOptionsReferenceOf,
  resourceKindFieldOptionsOwner,
  settingFieldOptionsReference,
  withFieldOptionsOwner,
} from "./field-options-reference";

const REWARDS = {
  kind: "internal" as const,
  request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
};

describe("fieldOptionsOwnerFromCanonicalId", () => {
  test("names the module, declaration and id of a trigger, action or widget", () => {
    expect(fieldOptionsOwnerFromCanonicalId("woofx3_twitch:trigger:channelpoints_redeem")).toEqual({
      moduleId: "woofx3_twitch",
      declaration: "trigger",
      declarationId: "channelpoints_redeem",
    });
    expect(fieldOptionsOwnerFromCanonicalId("woofx3:action:obs.switch_scene")).toEqual({
      moduleId: "woofx3",
      declaration: "action",
      declarationId: "obs.switch_scene",
    });
    expect(fieldOptionsOwnerFromCanonicalId("goals:widget:goal_bar")?.declaration).toBe("widget");
  });

  test("has no owner for a missing, malformed or other kind of id", () => {
    expect(fieldOptionsOwnerFromCanonicalId(undefined)).toBeUndefined();
    expect(fieldOptionsOwnerFromCanonicalId("woofx3:function:play_alert")).toBeUndefined();
    expect(fieldOptionsOwnerFromCanonicalId("woofx3:trigger")).toBeUndefined();
    expect(fieldOptionsOwnerFromCanonicalId(":trigger:x")).toBeUndefined();
    expect(fieldOptionsOwnerFromCanonicalId("woofx3:1.0.0:abc1234:trigger:x")).toBeUndefined();
  });
});

describe("resource and setting owners", () => {
  test("address a resource kind by its kind, and a setting by its module alone", () => {
    expect(resourceKindFieldOptionsOwner("counter", "counter")).toEqual({
      moduleId: "counter",
      declaration: "resource",
      declarationId: "counter",
    });
    expect(settingFieldOptionsReference("spotify", "testConnection")).toEqual({
      moduleId: "spotify",
      declaration: "setting",
      fieldId: "testConnection",
    });
  });

  test("have none without a module", () => {
    expect(resourceKindFieldOptionsOwner(undefined, "counter")).toBeUndefined();
    expect(resourceKindFieldOptionsOwner("", "counter")).toBeUndefined();
    expect(settingFieldOptionsReference("", "testConnection")).toBeUndefined();
  });
});

describe("withFieldOptionsOwner", () => {
  const fields: ConfigField[] = [
    { id: "rewardId", label: "Reward", type: "select", source: REWARDS },
    { id: "command", label: "Command", type: "select", source: { kind: "commands" } },
    { id: "message", label: "Message", type: "text" },
  ];
  const owner = { moduleId: "woofx3_twitch", declaration: "trigger" as const, declarationId: "channelpoints_redeem" };

  test("gives each internal source the reference of its own field", () => {
    const [reward] = withFieldOptionsOwner(fields, owner);
    expect(reward?.source?.kind === "internal" ? fieldOptionsReferenceOf(reward.source) : undefined).toEqual({
      ...owner,
      fieldId: "rewardId",
    });
  });

  test("leaves every other field as it was", () => {
    const [, command, message] = withFieldOptionsOwner(fields, owner);
    expect(command).toBe(fields[1]);
    expect(message).toBe(fields[2]);
  });

  test("does not change the fields it was given", () => {
    withFieldOptionsOwner(fields, owner);
    expect(fieldOptionsReferenceOf(REWARDS)).toBeUndefined();
  });

  test("leaves sources without a reference when there is no owner", () => {
    const [reward] = withFieldOptionsOwner(fields, undefined);
    expect(reward).toBe(fields[0]);
  });
});
