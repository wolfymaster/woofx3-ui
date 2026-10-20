import { describe, expect, test } from "bun:test";
import type { WorkflowRecord } from "@/engine/types";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import type { EventEditorState } from "@/lib/event-drafts";
import { eventWorkflowTarget, newProjectedAction, withNewTrigger } from "@/lib/event-workflow-state";
import type { ActionPreset, ConfigField } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as ActionPreset["icon"];

const increment: ActionPreset = {
  id: "row-1",
  name: "Increment counter",
  description: "",
  icon,
  category: "General",
  color: "#888",
  handlerType: "function",
  functionCall: "woofx3:function:counter.increment",
  config: {
    fields: [
      { id: "target", label: "Counter", type: "resource_ref", resourceKind: "counter" },
      // Optional, and blank means the counter's own step — so it must not be seeded.
      { id: "amount", label: "Amount", type: "number", min: 1 },
    ] as ConfigField[],
  },
};

const empty: EventEditorState = { name: "Chat command triggers", triggers: [], shared: [], conditionValues: {} };

describe("newProjectedAction", () => {
  test("the step is seeded the way the builder seeds it", () => {
    const action = newProjectedAction("act_1", increment);
    expect(action.parameters).toEqual({ target: "", amount: 1 });
    expect(action.functionCall).toBe("woofx3:function:counter.increment");
  });
});

describe("withNewTrigger", () => {
  const command: ConfigField[] = [{ id: "command", label: "Command", type: "text", required: true } as ConfigField];

  test("a new trigger starts with its fields' defaults and no steps", () => {
    const { state, triggerId } = withNewTrigger(empty, command);
    const trigger = state.triggers.find((candidate) => candidate.id === triggerId);
    expect(trigger?.actions).toEqual([]);
    expect(trigger?.enabled).toBe(true);
    expect(state.conditionValues[triggerId]).toEqual({ command: "" });
  });

  test("ids do not collide with the ones already in the workflow", () => {
    const first = withNewTrigger(empty, command);
    const second = withNewTrigger(first.state, command);
    expect(first.triggerId).not.toBe(second.triggerId);
  });
});

function workflow(event: string, tasks: unknown[], engineWorkflowId: string): WorkflowRecord {
  return {
    engineWorkflowId,
    isEnabled: true,
    definition: escapeDollarKeys({ name: event, trigger: { type: "event", event }, tasks }),
  };
}

describe("eventWorkflowTarget", () => {
  test("the first workflow it can project is the one edited; the rest are left alone", () => {
    const unprojectable = workflow("channel.raid", [{ id: "wait_1", type: "delay", parameters: {} }], "wf-1");
    const editable = workflow("channel.raid", [], "wf-2");
    const other = workflow("channel.raid", [], "wf-3");
    const target = eventWorkflowTarget([unprojectable, editable, other], "channel.raid");
    expect(target.primary?.engineWorkflowId).toBe("wf-2");
    expect(target.unprojectable?.engineWorkflowId).toBe("wf-1");
    expect(target.others.map((row) => row.engineWorkflowId)).toEqual(["wf-1", "wf-3"]);
  });

  test("another event's workflows are not this event's", () => {
    expect(eventWorkflowTarget([workflow("channel.follow", [], "wf-1")], "channel.raid").primary).toBeUndefined();
  });
});
