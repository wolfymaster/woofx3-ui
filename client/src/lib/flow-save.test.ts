import { describe, expect, test } from "bun:test";
import { type FlowSaveFacts, flowSaveView } from "@/lib/flow-save";

const facts: FlowSaveFacts = { changed: false, phase: "idle", problem: null, notSavedYet: null };

describe("flowSaveView", () => {
  test.each<[string, Partial<FlowSaveFacts>, string, string]>([
    ["nothing changed", {}, "saved", "All changes saved"],
    ["a change", { changed: true }, "unsaved", "Unsaved changes"],
    ["a save in flight", { changed: true, phase: "saving" }, "saving", "Saving…"],
    ["a failed save", { changed: true, phase: "failed" }, "failed", "Couldn't save. Your changes are still here."],
    ["a failed save since undone", { phase: "failed" }, "saved", "All changes saved"],
    ["a problem", { changed: true, problem: "Fix it." }, "blocked", "Can't save yet. Fix it."],
    [
      "a problem after a failure",
      { changed: true, phase: "failed", problem: "Fix it." },
      "blocked",
      "Can't save yet. Fix it.",
    ],
    ["a flow with no steps yet", { notSavedYet: "Add a step." }, "unsaved", "Add a step."],
  ])("%s", (_name, given, tone, text) => {
    expect(flowSaveView({ ...facts, ...given })).toEqual({ tone: tone as never, text });
  });
});
