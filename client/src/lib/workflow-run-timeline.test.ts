import { describe, expect, test } from "bun:test";
import { buildTimeline, formatDuration, parseTrigger, presentPayload, toneFor } from "./workflow-run-timeline";

const RUN = {
  engineRunId: "run-1",
  workflowId: "wf-1",
  status: "failed",
  triggerEvent:
    '{"id":"ev-1","type":"channel.follow","source":"twitch","platform":"twitch","time":"2026-09-17T08:49:58Z"}',
  startedAt: "2026-09-17T08:49:58.000Z",
  completedAt: "2026-09-17T08:49:59.500Z",
};

describe("toneFor", () => {
  test("maps the engine's run and step statuses", () => {
    expect(toneFor("running")).toBe("running");
    expect(toneFor("completed")).toBe("success");
    expect(toneFor("success")).toBe("success");
    expect(toneFor("failed")).toBe("failure");
    expect(toneFor("skipped")).toBe("neutral");
  });

  // A status the engine adds later must not be drawn as a success or a
  // failure it is not.
  test("treats an unknown status as neutral", () => {
    expect(toneFor("paused")).toBe("neutral");
  });
});

describe("presentPayload", () => {
  // `{}` is what the db proxy stores for a step with nothing to record.
  test("hides empty payloads", () => {
    expect(presentPayload(undefined)).toBeNull();
    expect(presentPayload("")).toBeNull();
    expect(presentPayload("{}")).toBeNull();
    expect(presentPayload("null")).toBeNull();
  });

  test("keeps a real payload verbatim", () => {
    expect(presentPayload('{"sent":true}')).toBe('{"sent":true}');
  });
});

describe("parseTrigger", () => {
  test("reads the event's identity", () => {
    const trigger = parseTrigger(RUN.triggerEvent);
    expect(trigger?.type).toBe("channel.follow");
    expect(trigger?.source).toBe("twitch");
    expect(trigger?.platform).toBe("twitch");
    expect(trigger?.occurredAt).toBe("2026-09-17T08:49:58Z");
  });

  // An unreadable trigger is exactly when someone needs to see what arrived,
  // so the raw text is still offered rather than dropped.
  test("still offers a malformed payload for viewing", () => {
    const trigger = parseTrigger("not json");
    expect(trigger?.type).toBe("unreadable event");
    expect(trigger?.payload).toBe("not json");
  });

  test("returns null when no event was stored", () => {
    expect(parseTrigger(undefined)).toBeNull();
    expect(parseTrigger("{}")).toBeNull();
  });
});

describe("buildTimeline", () => {
  const steps = [
    { taskId: "alert", status: "failed", attempt: 1, stepIndex: 1, error: "layout must be an object, got nothing" },
    { taskId: "fetch", status: "success", attempt: 1, stepIndex: 0, outputs: '{"user":"x"}', durationMs: 40 },
  ];

  test("orders steps by execution position, not arrival", () => {
    const timeline = buildTimeline(RUN, steps);
    expect(timeline.steps.map((step) => step.taskId)).toEqual(["fetch", "alert"]);
  });

  test("identifies the step that ended the run", () => {
    expect(buildTimeline(RUN, steps).failedStep?.taskId).toBe("alert");
  });

  // The engine's refusal reasons share a vocabulary with the scene manager,
  // so the alert-failure copy reads a failed step too.
  test("turns a known failure reason into readable copy", () => {
    const alert = buildTimeline(RUN, steps).steps[1];
    expect(alert?.failure?.title).toBe("This alert has no layout");
  });

  test("uses the last failed attempt when a step was retried", () => {
    const retried = [
      { taskId: "alert", status: "failed", attempt: 1, stepIndex: 0, error: "first" },
      { taskId: "alert", status: "failed", attempt: 2, stepIndex: 0, error: "second" },
    ];
    expect(buildTimeline(RUN, retried).failedStep?.error).toBe("second");
  });

  test("has no failed step when the run succeeded", () => {
    const fetchOnly = { taskId: "fetch", status: "success", attempt: 1, stepIndex: 0 };
    const ok = buildTimeline({ ...RUN, status: "completed" }, [fetchOnly]);
    expect(ok.failedStep).toBeNull();
    expect(ok.tone).toBe("success");
  });

  test("derives run duration from its timestamps", () => {
    expect(buildTimeline(RUN, steps).durationMs).toBe(1500);
  });

  test("hides empty step payloads", () => {
    const alert = buildTimeline(RUN, steps).steps[1];
    expect(alert?.inputs).toBeNull();
    expect(alert?.outputs).toBeNull();
  });
});

describe("formatDuration", () => {
  test("scales its unit to the size of the value", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(314)).toBe("314ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});
