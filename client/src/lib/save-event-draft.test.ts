import { beforeEach, describe, expect, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { WorkflowRecord } from "@/engine/types";
import { type EventEditorState, getDraft, isDraftDirty, setDraft, updateDraftValue } from "@/lib/event-drafts";
import { eventEditorStateFor } from "@/lib/event-workflow-state";
import { type EngineWorkflowWriters, saveEventDraft } from "@/lib/save-event-draft";
import { UNCONDITIONAL_TRIGGER_ID } from "@/lib/trigger-projection";
import type { TriggerPreset } from "@/lib/workflow-presets";

const EVENT = "reward.redeemed";
const fields = [{ id: "rewardId", label: "Reward", type: "select" as const, eventPath: "rewardId" }];
const preset = { event: EVENT, name: "Reward redeemed" } as TriggerPreset;

const alertStep = (id: string) => ({
  id,
  handlerType: "function",
  functionCall: "woofx3:function:alert",
  parameters: { target: "default" },
  concurrentWithPrevious: false,
});

/** A new trigger left on Any, with an alert step: what "New trigger" then "Play an on-stream alert" makes. */
const anyTrigger: EventEditorState = {
  name: "Reward redeemed triggers",
  triggers: [{ id: "rule_1", enabled: true, conditions: [], actions: [alertStep("act_1")] }],
  shared: [],
  conditionValues: { rule_1: { rewardId: null } },
};

/** The engine's side: definitions as sent, and the rows the workflows query then returns. */
function fakeEngine() {
  const rows: WorkflowRecord[] = [];
  const store = (engineWorkflowId: string, definition: unknown) => {
    rows.splice(0, rows.length, { engineWorkflowId, definition, isEnabled: true } as WorkflowRecord);
  };
  const writers: EngineWorkflowWriters = {
    instanceId: "instance-1" as Id<"instances">,
    createFromDefinition: async (_instanceId, definition) => {
      store("wf-1", definition);
      return { engineWorkflowId: "wf-1" };
    },
    updateFromDefinition: async (_instanceId, engineWorkflowId, definition) => {
      store(engineWorkflowId, definition);
      return {};
    },
    setEnabled: async () => ({}),
  };
  return { rows, writers };
}

function open(state: EventEditorState) {
  setDraft(EVENT, { value: state, baseline: JSON.stringify({ ...state, triggers: [] }) });
}

function savedDraft() {
  const draft = getDraft(EVENT);
  if (!draft) {
    throw new Error("the save left no draft");
  }
  return draft;
}

describe("saveEventDraft", () => {
  let engine: ReturnType<typeof fakeEngine>;
  beforeEach(() => {
    engine = fakeEngine();
  });

  test("leaves the draft reading as the engine's copy will, so step links survive the reload of it", async () => {
    open(anyTrigger);

    await saveEventDraft(EVENT, anyTrigger, fields, engine.writers);

    const draft = savedDraft();
    expect(isDraftDirty(draft)).toBe(false);
    expect(draft.baseline).toBe(JSON.stringify(eventEditorStateFor(engine.rows, preset, fields)));
    // "Edit alert" links to the trigger and step ids the draft holds now.
    expect(draft.value.triggers.map((trigger) => trigger.id)).toEqual([UNCONDITIONAL_TRIGGER_ID]);
    expect(draft.value.triggers.flatMap((trigger) => trigger.actions.map((action) => action.id))).toEqual(["act_1"]);
  });

  test("takes the id a first save minted, so the next save updates rather than creating again", async () => {
    open(anyTrigger);

    await saveEventDraft(EVENT, anyTrigger, fields, engine.writers);

    expect(savedDraft().value.engineWorkflowId).toBe("wf-1");
  });

  test("keeps a trigger with conditions under its own id", async () => {
    const state: EventEditorState = { ...anyTrigger, conditionValues: { rule_1: { rewardId: "abc" } } };
    open(state);

    await saveEventDraft(EVENT, state, fields, engine.writers);

    const draft = savedDraft();
    expect(draft.value.triggers.map((trigger) => trigger.id)).toEqual(["rule_1"]);
    expect(draft.value.conditionValues.rule_1).toEqual({ rewardId: "abc" });
  });

  test("keeps edits made while the save was in flight, still unsaved", async () => {
    open(anyTrigger);
    const writers: EngineWorkflowWriters = {
      ...engine.writers,
      createFromDefinition: async (instanceId, definition) => {
        updateDraftValue(EVENT, (value) => ({ ...value, name: "Renamed meanwhile" }));
        return engine.writers.createFromDefinition(instanceId, definition);
      },
    };

    await saveEventDraft(EVENT, anyTrigger, fields, writers);

    const draft = savedDraft();
    expect(draft.value.name).toBe("Renamed meanwhile");
    expect(isDraftDirty(draft)).toBe(true);
    expect(draft.baseline).toBe(JSON.stringify(eventEditorStateFor(engine.rows, preset, fields)));
  });
});
