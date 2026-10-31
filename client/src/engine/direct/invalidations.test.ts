import { describe, expect, test } from "bun:test";
import { type CallbackEnvelope, EngineEventType, makeCallbackEnvelope } from "@woofx3/api";
import { INVALIDATIONS, invalidatedBy } from "./invalidations";
import { directKeys as k } from "./keys";

describe("INVALIDATIONS", () => {
  test("has a row for every engine event type and nothing else", () => {
    expect(Object.keys(INVALIDATIONS).sort()).toEqual(Object.values(EngineEventType).sort());
  });

  test.each([
    [
      "an alert event refreshes the whole alert queue",
      makeCallbackEnvelope({
        type: EngineEventType.ALERT_COMPLETED,
        alert: {
          id: "a-1",
          payload: "{}",
          workflowId: "",
          sourceEventId: "",
          status: "completed",
          createdAt: "2026-10-28T12:00:00Z",
          updatedAt: "2026-10-28T12:00:01Z",
        },
      }),
      [k.alertQueue.all],
    ],
    [
      "an alert a run published refreshes the queue and that run",
      makeCallbackEnvelope({
        type: EngineEventType.ALERT_PLAYING,
        alert: {
          id: "a-2",
          payload: "{}",
          workflowId: "run-1",
          sourceEventId: "",
          status: "playing",
          createdAt: "2026-10-28T12:00:00Z",
          updatedAt: "2026-10-28T12:00:01Z",
        },
      }),
      [k.alertQueue.all, k.workflows.run("run-1")],
    ],
    [
      "a change to the Twitch link refreshes the link the Twitch namespaces read",
      makeCallbackEnvelope({ type: EngineEventType.TWITCH_LINK_CHANGED, revision: 2, linked: false }),
      [k.twitch.link()],
    ],
    [
      "a stream going offline refreshes the live state and the recaps",
      makeCallbackEnvelope({ type: EngineEventType.STREAM_OFFLINE, twitchUserId: "u-1" }),
      [k.status.liveState(), k.streamOps.allRecaps],
    ],
    [
      "a deleted command refreshes the command list and the alert target usage",
      makeCallbackEnvelope({ type: EngineEventType.COMMAND_DELETED, commandId: "c-1" }),
      [k.commands.list(), k.scenes.allAlertTargetUsage],
    ],
    [
      "a deleted group refreshes the groups and its members",
      makeCallbackEnvelope({ type: EngineEventType.GROUP_DELETED, groupId: "g-1" }),
      [k.commands.groups(), k.commands.members("g-1")],
    ],
    [
      "a member change refreshes that group's members only",
      makeCallbackEnvelope({ type: EngineEventType.GROUP_MEMBER_ADDED, groupId: "g-1", username: "ann" }),
      [k.commands.members("g-1")],
    ],
    [
      "a deleted library alert refreshes the alert library",
      makeCallbackEnvelope({ type: EngineEventType.SCENE_DELETED, sceneId: "a-1", kind: "alert" }),
      [k.alertLibrary.all],
    ],
    [
      "a deleted scene refreshes every scene read",
      makeCallbackEnvelope({ type: EngineEventType.SCENE_DELETED, sceneId: "s-1", kind: "scene" }),
      [k.scenes.all],
    ],
    [
      "a deleted workflow refreshes the workflows, its health and the alert target usage",
      makeCallbackEnvelope({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w-1" }),
      [k.workflows.list(), k.workflows.detail("w-1"), k.workflows.health(), k.scenes.allAlertTargetUsage],
    ],
    [
      "a recorded step refreshes its run",
      makeCallbackEnvelope({
        type: EngineEventType.WORKFLOW_RUN_STEP_RECORDED,
        step: {
          id: "s-1",
          executionId: "run-1",
          taskId: "t-1",
          status: "completed",
          attempt: 1,
          stepIndex: 0,
          createdAt: "",
          updatedAt: "",
        },
      }),
      [k.workflows.run("run-1")],
    ],
    [
      "a module's new trigger refreshes the builder's catalog",
      makeCallbackEnvelope({
        type: EngineEventType.MODULE_TRIGGER_DEREGISTERED,
        moduleKey: "counter",
        triggers: [],
      } as never),
      [k.workflows.catalog()],
    ],
    [
      "a write under a resource value's storage key refreshes the values",
      makeCallbackEnvelope({
        type: EngineEventType.MODULE_STORAGE_CHANGED,
        moduleId: "counter",
        key: "state:counter:counter:deaths",
        value: 1,
        occurredAt: "",
      }),
      [k.moduleResources.values()],
    ],
    [
      "a write under any other storage key caches nothing",
      makeCallbackEnvelope({
        type: EngineEventType.MODULE_STORAGE_CHANGED,
        moduleId: "counter",
        key: "settings:theme",
        value: 1,
        occurredAt: "",
      }),
      [],
    ],
    [
      "an engine response feeds a transient event and caches nothing",
      makeCallbackEnvelope({
        type: EngineEventType.ENGINE_RESPONSE_RECEIVED,
        correlationKey: "c",
        status: "success",
        data: {},
      }),
      [],
    ],
  ] as const)("%s", (_case, envelope, keys) => {
    expect(invalidatedBy(envelope as CallbackEnvelope)).toEqual(keys);
  });

  test("an event type this build does not know makes everything stale", () => {
    const envelope = {
      ...makeCallbackEnvelope({ type: EngineEventType.COMMAND_DELETED, commandId: "c-1" }),
      type: "something.new",
    } as unknown as CallbackEnvelope;
    expect(invalidatedBy(envelope)).toBe("everything");
  });
});
