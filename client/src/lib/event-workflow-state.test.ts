import { describe, expect, test } from "bun:test";
import type { Doc } from "@convex/_generated/dataModel";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import type { EventEditorState } from "@/lib/event-drafts";
import { eventWorkflowTarget, newProjectedAction, withNewTrigger } from "@/lib/event-workflow-state";
import { resourceActions } from "@/lib/resource-actions";
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

const actionScope = { actions: resourceActions([increment], "counter"), value: "woofx3:counter:deaths" };

const empty: EventEditorState = { name: "Chat command triggers", triggers: [], shared: [], conditionValues: {} };

describe("newProjectedAction", () => {
  test("aims the step at the scoped instance and leaves its other settings unset", () => {
    const action = newProjectedAction("act_1", increment, actionScope);
    expect(action.parameters).toEqual({ target: "woofx3:counter:deaths" });
    expect(action.functionCall).toBe("woofx3:function:counter.increment");
  });

  test("without a scope the step is seeded the way the builder seeds it", () => {
    expect(newProjectedAction("act_1", increment).parameters).toEqual({ target: "", amount: 1 });
  });

  test("an action the scope does not cover keeps its defaults", () => {
    const reply: ActionPreset = {
      ...increment,
      id: "row-2",
      name: "Send chat message",
      handlerType: "chat.reply",
      functionCall: undefined,
      config: { fields: [{ id: "message", label: "Message", type: "text" }] as ConfigField[] },
    };
    expect(newProjectedAction("act_1", reply, actionScope).parameters).toEqual({ message: "" });
  });
});

describe("withNewTrigger", () => {
  const command: ConfigField[] = [{ id: "command", label: "Command", type: "text", required: true } as ConfigField];

  test("a seeded trigger arrives already running the step, aimed at the instance", () => {
    const { state, triggerId } = withNewTrigger(empty, command, { actionScope, seed: increment });
    const trigger = state.triggers.find((candidate) => candidate.id === triggerId);
    expect(trigger?.actions).toHaveLength(1);
    expect(trigger?.actions[0].parameters).toEqual({ target: "woofx3:counter:deaths" });
    expect(trigger?.enabled).toBe(true);
  });

  test("ids do not collide with the ones already in the workflow", () => {
    const first = withNewTrigger(empty, command, { actionScope, seed: increment });
    const second = withNewTrigger(first.state, command, { actionScope, seed: increment });
    const ids = second.state.triggers.flatMap((trigger) => [trigger.id, ...trigger.actions.map((a) => a.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.triggerId).not.toBe(second.triggerId);
  });

  test("a condition scope pins its field on the new trigger", () => {
    const scope = { fieldId: "counter", value: "woofx3:counter:deaths", label: "Deaths" };
    const { state, triggerId } = withNewTrigger(empty, [{ id: "counter", label: "Counter" } as ConfigField], {
      scope,
    });
    expect(state.conditionValues[triggerId].counter).toBe("woofx3:counter:deaths");
  });
});

function workflow(event: string, tasks: unknown[], engineWorkflowId: string): Doc<"workflows"> {
  return {
    engineWorkflowId,
    isEnabled: true,
    definition: escapeDollarKeys({ name: event, trigger: { type: "event", event }, tasks }),
  } as Doc<"workflows">;
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
