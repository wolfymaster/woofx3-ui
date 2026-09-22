import { describe, expect, test } from "bun:test";
import { alertTone, axisTicks, buildTrace, initialSpanId } from "./run-trace";
import { buildTimeline } from "./workflow-run-timeline";

const RUN = {
  engineRunId: "run-1",
  workflowId: "wf-1",
  status: "completed",
  triggerEvent: '{"type":"channel.follow","platform":"twitch","time":"2026-09-17T08:49:57.800Z","data":{}}',
  startedAt: "2026-09-17T08:49:58.000Z",
  completedAt: "2026-09-17T08:49:58.500Z",
};

const STEPS = [
  {
    taskId: "fetch",
    status: "success",
    attempt: 1,
    stepIndex: 0,
    startedAt: "2026-09-17T08:49:58.010Z",
    completedAt: "2026-09-17T08:49:58.110Z",
  },
  {
    taskId: "alert",
    status: "success",
    attempt: 1,
    stepIndex: 1,
    completedAt: "2026-09-17T08:49:58.400Z",
    durationMs: 200,
  },
];

const ALERT = {
  engineAlertId: "a-1",
  status: "completed",
  payload: "{}",
  dispatchedAt: "2026-09-17T08:49:58.400Z",
  playedAt: "2026-09-17T08:49:59.000Z",
  completedAt: "2026-09-17T08:50:03.000Z",
  engineCreatedAt: "2026-09-17T08:49:58.400Z",
};

function trace(run = RUN, steps = STEPS, alerts = [ALERT]) {
  return buildTrace(run, buildTimeline(run, steps), alerts);
}

describe("buildTrace", () => {
  test("orders spans as trigger, run, steps, then the alerts the run published", () => {
    expect(trace().spans.map((span) => span.id)).toEqual([
      "trigger",
      "run",
      "step:fetch:1",
      "step:alert:1",
      "alert:a-1",
    ]);
  });

  test("measures every offset from the earliest known moment", () => {
    const { spans, originMs, spanMs } = trace();
    expect(originMs).toBe(Date.parse("2026-09-17T08:49:57.800Z"));
    expect(spans[0]?.startMs).toBe(0);
    expect(spans[1]?.startMs).toBe(200);
    expect(spanMs).toBe(5200);
  });

  // The trigger is an instant, not a span of time.
  test("draws the trigger as a point", () => {
    expect(trace().spans[0]?.endMs).toBeNull();
  });

  test("recovers a step's start from its end and duration", () => {
    const alertStep = trace().spans[3];
    expect(alertStep?.startMs).toBe(400);
    expect(alertStep?.endMs).toBe(600);
  });

  test("marks when an alert began to play", () => {
    expect(trace().spans[4]?.marks).toEqual([{ atMs: 1200, label: "Started playing" }]);
  });

  // A platform clock far from the engine's would squash the run into a sliver.
  test("keeps a trigger whose time is far from the run off the axis", () => {
    const skewed = { ...RUN, triggerEvent: '{"type":"channel.follow","time":"2026-09-17T07:00:00Z"}' };
    const result = trace(skewed);
    expect(result.spans[0]?.startMs).toBeNull();
    expect(result.originMs).toBe(Date.parse(RUN.startedAt));
  });

  test("leaves a step with no timing in the list, untimed", () => {
    const result = trace(RUN, [{ taskId: "x", status: "success", attempt: 1, stepIndex: 0 }], []);
    const step = result.spans.find((span) => span.kind === "step");
    expect(step?.startMs).toBeNull();
  });

  test("keeps a running run open to the end of the axis", () => {
    const running = { ...RUN, status: "running", completedAt: undefined };
    const run = trace(running, STEPS, []).spans[1];
    expect(run?.open).toBe(true);
    expect(run?.endMs).toBeNull();
  });

  test("survives a run with nothing timed", () => {
    const bare = { engineRunId: "r", workflowId: "w", status: "completed" };
    const result = buildTrace(bare, buildTimeline(bare, []), []);
    expect(result.originMs).toBeNull();
    expect(result.spanMs).toBe(1);
    expect(result.spans.map((span) => span.id)).toEqual(["run"]);
  });

  // Go writes nanoseconds; not every browser's Date.parse reads them.
  test("reads engine timestamps with nanosecond fractions", () => {
    const nanos = { ...RUN, startedAt: "2026-09-17T08:49:58.000123456Z" };
    expect(trace(nanos).spans[1]?.startMs).toBe(200);
  });
});

describe("axisTicks", () => {
  test("lands on round numbers", () => {
    expect(axisTicks(5200)).toEqual([0, 2000, 4000]);
    expect(axisTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(axisTicks(37)).toEqual([0, 10, 20, 30]);
  });
});

describe("initialSpanId", () => {
  test("opens on the step that failed", () => {
    const failed = [{ ...STEPS[0], status: "failed", error: "boom" }, STEPS[1]];
    expect(initialSpanId(trace({ ...RUN, status: "failed" }, failed, []))).toBe("step:fetch:1");
  });

  test("opens on the trigger when nothing failed", () => {
    expect(initialSpanId(trace())).toBe("trigger");
  });
});

describe("alertTone", () => {
  test("follows the alert lifecycle", () => {
    expect(alertTone("completed")).toBe("success");
    expect(alertTone("timed_out")).toBe("failure");
    expect(alertTone("playing")).toBe("running");
    expect(alertTone("skipped")).toBe("neutral");
  });
});
