import { describe, expect, test } from "bun:test";
import { triggerDefinitionRow } from "@shared/definition-rows";
import { triggerSnapshot } from "./engineSync/steps/triggers";

const segmentEntered = {
  id: "viewer_segment_entered",
  name: "Viewer entered segment",
  description: "Fires when a viewer starts matching a segment.",
  event: "viewer.segment.entered",
  configSchema: JSON.stringify([{ id: "segment", label: "Segment", type: "text", eventPath: "segmentId" }]),
  emits: JSON.stringify({
    fields: [
      { path: "viewerId", type: "string", identity: "viewer", displayName: "viewerName" },
      { path: "viewerName", type: "string" },
      { path: "segmentId", type: "string" },
      { path: "facts", type: "object" },
    ],
  }),
  sentence: "a viewer enters {segment}",
  allowVariants: false,
  taxonomy: ["system.viewer"],
  createdByType: "MODULE",
  createdByRef: "woofx3",
  transport: "eventbus",
};

describe("triggerDefinitionRow", () => {
  test("keeps what a synced trigger emits, so its test form can offer fields", () => {
    const row = triggerDefinitionRow(triggerSnapshot(segmentEntered), undefined);
    expect(row.emits).toEqual([
      { path: "viewerId", type: "string", identity: "viewer", displayName: "viewerName" },
      { path: "viewerName", type: "string" },
      { path: "segmentId", type: "string" },
      { path: "facts", type: "object" },
    ]);
  });

  test("keeps a synced trigger's sentence", () => {
    const row = triggerDefinitionRow(triggerSnapshot(segmentEntered), undefined);
    expect(row.sentence).toBe("a viewer enters {segment}");
  });

  test("keeps how a synced trigger's event reads in the alert feed", () => {
    const emits = JSON.parse(segmentEntered.emits);
    const row = triggerDefinitionRow(
      triggerSnapshot({
        ...segmentEntered,
        emits: JSON.stringify({ ...emits, summary: "{viewerName} joined {segmentId}", details: ["{segmentId}"] }),
      }),
      undefined
    );
    expect(row.summary).toBe("{viewerName} joined {segmentId}");
    expect(row.summaryDetails).toEqual(["{segmentId}"]);
  });

  test("clears emits for a trigger that declares nothing", () => {
    const row = triggerDefinitionRow({ id: "counter_goal", emits: "{}" }, undefined);
    expect(row.emits).toBeUndefined();
    expect(row).toHaveProperty("emits");
    // Present though undefined, so a patch clears a summary the module dropped.
    expect(row).toHaveProperty("summary");
    expect(row).toHaveProperty("summaryDetails");
  });
});
