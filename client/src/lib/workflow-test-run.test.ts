import { describe, expect, test } from "bun:test";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { TriggerPreset } from "@/lib/workflow-presets";
import {
  describeUnmetCondition,
  isStickyOutcome,
  type ListeningWorkflow,
  otherWorkflowsOnEvent,
  presetPlatform,
  resolveTestRunOutcome,
  sampleEventRefusal,
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

describe("sampleEventRefusal", () => {
  test("refuses going live and going offline, and their longer forms", () => {
    expect(sampleEventRefusal("stream.online")).toContain("stream session");
    expect(sampleEventRefusal("stream.offline")).toContain("stream session");
    expect(sampleEventRefusal("stream.online.twitch")).not.toBeNull();
  });

  test("allows everything else", () => {
    expect(sampleEventRefusal("channel.raid")).toBeNull();
    expect(sampleEventRefusal("stream.onlineish")).toBeNull();
    expect(sampleEventRefusal(undefined)).toBeNull();
  });
});

describe("resolveTestRunOutcome", () => {
  const waiting = { kind: "waiting" } as const;
  const nothing = { kind: "nothingMatched" } as const;
  const running = { kind: "running" } as const;

  test("a recorded settled run wins over live rows", () => {
    expect(resolveTestRunOutcome(running, null, { status: "completed" }).kind).toBe("succeeded");
    expect(resolveTestRunOutcome(running, null, { status: "failed", error: "boom" }).kind).toBe("failed");
  });

  test("a stopped run says so", () => {
    const outcome = resolveTestRunOutcome(running, null, { status: "cancelled" });
    expect(outcome.kind === "failed" && outcome.title).toBe("The run was stopped");
  });

  test("keeps the last live answer once the live rows expire", () => {
    expect(resolveTestRunOutcome(nothing, running, null).kind).toBe("running");
    expect(resolveTestRunOutcome(nothing, running, { status: "running" }).kind).toBe("running");
  });

  test("a live terminal answer beats a recorded run still catching up", () => {
    expect(resolveTestRunOutcome({ kind: "succeeded" }, running, { status: "running" }).kind).toBe("succeeded");
  });

  test("falls back to the live reading when nothing else is known", () => {
    expect(resolveTestRunOutcome(waiting, null, null).kind).toBe("waiting");
    expect(resolveTestRunOutcome(nothing, null, null).kind).toBe("nothingMatched");
  });

  test("only settled answers are kept", () => {
    expect(isStickyOutcome(running)).toBe(true);
    expect(isStickyOutcome(waiting)).toBe(false);
    expect(isStickyOutcome(nothing)).toBe(false);
  });
});

describe("presetPlatform", () => {
  test("reads the platform axis of the taxonomy", () => {
    expect(presetPlatform({ taxonomy: ["alert.raid", "platform.twitch"] })).toBe("twitch");
  });

  test("is undefined without one", () => {
    expect(presetPlatform({ taxonomy: ["alert.raid"] })).toBeUndefined();
    expect(presetPlatform({})).toBeUndefined();
    expect(presetPlatform({ taxonomy: ["platform."] })).toBeUndefined();
  });
});

describe("describeUnmetCondition", () => {
  test("reads field, operator and value, quoting strings", () => {
    expect(describeUnmetCondition({ field: "viewers", operator: "gte", value: 10 })).toBe("viewers gte 10");
    expect(describeUnmetCondition({ field: "user", operator: "eq", value: "bob" })).toBe('user eq "bob"');
  });

  test("adds why a condition could not be evaluated", () => {
    expect(describeUnmetCondition({ field: "x", operator: "near", value: 1, error: "unknown operator" })).toBe(
      "x near 1 (unknown operator)"
    );
  });
});

describe("testRunProgress on a cancelled run", () => {
  test("reads the cancelled lifecycle row as a stop, not a failure", () => {
    const rows: TransientRunRow[] = [
      { type: "workflow.run.started", status: "progress", data: { workflowId: "wf", executionId: "run-1" } },
      {
        type: "workflow.run.cancelled",
        status: "error",
        message: "cancelled: from the dashboard",
        data: { workflowId: "wf", executionId: "run-1" },
      },
    ];
    const outcome = testRunProgress(rows, "wf", false).outcome;
    expect(outcome.kind === "failed" && outcome.title).toBe("The run was stopped");
  });
});
