import { describe, expect, it } from "bun:test";
import {
  buildTriggerOptions,
  classifyOptionsProbe,
  dryRunWouldDo,
  MAX_TRIGGER_DATA_BYTES,
  optionsWereIgnored,
  type TriggerWorkflowResponse,
} from "./engineTestRun";

describe("dryRunWouldDo", () => {
  it("reads the description a dry-run step recorded", () => {
    expect(dryRunWouldDo('{"dryRun":true,"wouldDo":"Send chat message \\"hi\\""}')).toBe('Send chat message "hi"');
  });

  it("is null for a step that really ran, or unreadable outputs", () => {
    expect(dryRunWouldDo(undefined)).toBeNull();
    expect(dryRunWouldDo('{"sent":true}')).toBeNull();
    expect(dryRunWouldDo('{"dryRun":false,"wouldDo":"x"}')).toBeNull();
    expect(dryRunWouldDo('{"dryRun":true,"wouldDo":""}')).toBeNull();
    expect(dryRunWouldDo("not json")).toBeNull();
  });
});

describe("classifyOptionsProbe", () => {
  it("is supported when the engine refuses platform without triggerData", () => {
    const err = new Error("options.platform and options.skipConditions only apply with options.triggerData");
    expect(classifyOptionsProbe(err)).toBe("supported");
  });

  it("is unsupported when the engine ignored the options and looked the workflow up", () => {
    expect(classifyOptionsProbe(new Error('Workflow "\u0000woofx3-options-probe" not found'))).toBe("unsupported");
  });

  it("is unknown for anything else, so the caller can ask again", () => {
    expect(classifyOptionsProbe(new Error("fetch failed"))).toBe("unknown");
    expect(classifyOptionsProbe(null)).toBe("unknown");
  });
});

describe("buildTriggerOptions", () => {
  it("sends the sample with its platform and skip, and the dry run", () => {
    const built = buildTriggerOptions({
      triggerData: { viewers: 5 },
      platform: "twitch",
      skipConditions: true,
      dryRun: true,
    });
    expect(built).toEqual({
      ok: true,
      options: { triggerData: { viewers: 5 }, platform: "twitch", skipConditions: true, dryRun: true },
    });
  });

  it("drops platform and skipConditions without a sample, which the engine refuses alone", () => {
    expect(buildTriggerOptions({ platform: "twitch", skipConditions: true, dryRun: true })).toEqual({
      ok: true,
      options: { dryRun: true },
    });
    expect(buildTriggerOptions({})).toEqual({ ok: true, options: {} });
  });

  it("refuses a sample over the engine's limit", () => {
    const built = buildTriggerOptions({ triggerData: { text: "x".repeat(MAX_TRIGGER_DATA_BYTES) } });
    expect(built.ok).toBe(false);
  });
});

describe("optionsWereIgnored", () => {
  const response = (status: string): TriggerWorkflowResponse => ({
    executionId: status === "started" ? "run-1" : "",
    status,
    message: "",
    triggerId: "t",
  });

  it("is true when options were sent and the old requested answer came back", () => {
    expect(optionsWereIgnored({ triggerData: {} }, response("requested"))).toBe(true);
    expect(optionsWereIgnored({ dryRun: true }, response("requested"))).toBe(true);
  });

  it("is false when the engine answered, or nothing was asked", () => {
    expect(optionsWereIgnored({ triggerData: {} }, response("started"))).toBe(false);
    expect(optionsWereIgnored({ triggerData: {} }, response("conditions_not_met"))).toBe(false);
    expect(optionsWereIgnored({}, response("requested"))).toBe(false);
  });
});
