import { describe, expect, test } from "bun:test";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { TriggerPreset } from "@/lib/workflow-presets";
import {
  type ListeningWorkflow,
  otherWorkflowsOnEvent,
  type TransientRunRow,
  testRunPreset,
  testRunProgress,
  workflowEventTrigger,
} from "@/lib/workflow-test-run";

const icon = (() => null) as unknown as TriggerPreset["icon"];

function catalogRow(id: string, event: string, canonicalRef?: string): CatalogTriggerRow {
  return { id, event, canonicalRef, name: id, description: "", category: "General", color: "", icon: "" };
}

function preset(id: string, event: string): TriggerPreset {
  return { id, event, name: id, description: "", icon, category: "General", color: "" };
}

describe("workflowEventTrigger", () => {
  test("reads the event and the escaped $ref of a stored definition", () => {
    const stored = { trigger: { type: "event", event: "channel.raid", __$ref: "twitch:trigger:raid" } };
    expect(workflowEventTrigger(stored)).toEqual({ event: "channel.raid", ref: "twitch:trigger:raid" });
  });

  test("is null for a schedule trigger, a missing trigger, or no definition", () => {
    expect(workflowEventTrigger({ trigger: { type: "schedule", schedule: "* * * * *" } })).toBeNull();
    expect(workflowEventTrigger({})).toBeNull();
    expect(workflowEventTrigger(undefined)).toBeNull();
  });
});

describe("testRunPreset", () => {
  const catalog = [catalogRow("cmd", "chat.command"), catalogRow("raid", "channel.raid", "twitch:trigger:raid")];
  const presets = [preset("cmd", "chat.command"), preset("raid", "channel.raid")];

  test("fires the workflow's own event, not the catalog's base", () => {
    const result = testRunPreset({ event: "chat.command.hello" }, catalog, presets);
    expect(result?.id).toBe("cmd");
    expect(result?.event).toBe("chat.command.hello");
  });

  test("resolves by canonical ref first", () => {
    expect(testRunPreset({ event: "anything", ref: "twitch:trigger:raid" }, catalog, presets)?.id).toBe("raid");
  });

  test("is null for a trigger this instance's catalog does not have", () => {
    expect(testRunPreset({ event: "channel.cheer" }, catalog, presets)).toBeNull();
  });
});

describe("otherWorkflowsOnEvent", () => {
  const onRaid = { trigger: { type: "event", event: "channel.raid" } };
  const workflows: ListeningWorkflow[] = [
    { engineWorkflowId: "self", isEnabled: true, name: "Self", definition: onRaid },
    { engineWorkflowId: "b", isEnabled: true, name: "Raid shoutout", definition: onRaid },
    { engineWorkflowId: "c", isEnabled: false, name: "Old raid alert", definition: onRaid },
    {
      engineWorkflowId: "d",
      isEnabled: true,
      name: "Cheer alert",
      definition: { trigger: { type: "event", event: "channel.cheer" } },
    },
    { engineWorkflowId: "e", isEnabled: true, name: "Raid alert", definition: onRaid },
  ];

  test("names the other enabled workflows on the same event, sorted", () => {
    expect(otherWorkflowsOnEvent(workflows, "self", "channel.raid")).toEqual(["Raid alert", "Raid shoutout"]);
  });

  test("is empty when nothing else listens", () => {
    expect(otherWorkflowsOnEvent(workflows, "d", "channel.cheer")).toEqual([]);
  });
});

describe("testRunProgress", () => {
  const row = (status: TransientRunRow["status"], workflowId: string, executionId?: string, message?: string) => ({
    status,
    message,
    data: { workflowId, executionId },
  });

  test("waits while loading", () => {
    expect(testRunProgress(undefined, "wf", true).outcome.kind).toBe("waiting");
  });

  test("follows only this workflow's rows, latest last", () => {
    const rows = [row("progress", "wf", "run-1"), row("progress", "other", "run-2"), row("success", "wf", "run-1")];
    const progress = testRunProgress(rows, "wf", false);
    expect(progress.outcome.kind).toBe("succeeded");
    expect(progress.executionId).toBe("run-1");
    expect(progress.otherWorkflowCount).toBe(1);
  });

  test("reads another workflow's failure as none of its business", () => {
    const rows = [row("progress", "wf", "run-1"), row("error", "other", "run-2", "boom")];
    expect(testRunProgress(rows, "wf", false).outcome.kind).toBe("running");
  });

  test("reports that this workflow did not run once the wait elapses, even when others did", () => {
    const rows = [row("success", "other", "run-2")];
    expect(testRunProgress(rows, "wf", false).outcome.kind).toBe("waiting");
    const progress = testRunProgress(rows, "wf", true);
    expect(progress.outcome.kind).toBe("nothingMatched");
    expect(progress.executionId).toBeNull();
  });

  test("carries the failure reason", () => {
    const outcome = testRunProgress([row("error", "wf", "run-1", "step exploded")], "wf", false).outcome;
    expect(outcome.kind).toBe("failed");
  });
});
