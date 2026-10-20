import { describe, expect, test } from "bun:test";
import type { WorkflowRecord } from "@/engine/types";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { eventWorkflowTarget } from "@/lib/event-workflow-state";

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
