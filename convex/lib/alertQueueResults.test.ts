import { describe, expect, test } from "bun:test";
import { LEGACY_REPLAY_REFUSAL, readClearResult, readReplayResult, readSkipResult } from "./alertQueueResults";

describe("readSkipResult", () => {
  test("reads the current answer", () => {
    expect(readSkipResult({ ok: true, skipped: 2 })).toEqual({ ok: true, skipped: 2, reason: undefined });
    expect(readSkipResult({ ok: false, skipped: 0, reason: "no overlay is open" })).toEqual({
      ok: false,
      skipped: 0,
      reason: "no overlay is open",
    });
  });

  test("reads an older engine's boolean answer", () => {
    expect(readSkipResult({ skipped: true })).toEqual({ ok: true, skipped: 1 });
    expect(readSkipResult({ skipped: false })).toEqual({ ok: true, skipped: 0 });
  });

  test("rejects anything else", () => {
    expect(() => readSkipResult(null)).toThrow();
    expect(() => readSkipResult({ ok: true, skipped: -1 })).toThrow();
  });
});

describe("readClearResult", () => {
  test("reads the current answer", () => {
    expect(readClearResult({ ok: false, cleared: 0, reason: "no overlay is open" }).reason).toBe("no overlay is open");
  });

  test("reads an older engine's count", () => {
    expect(readClearResult({ cleared: 4 })).toEqual({ ok: true, cleared: 4 });
  });

  test("rejects an invalid count", () => {
    expect(() => readClearResult({ ok: true, cleared: 1.5 })).toThrow();
    expect(() => readClearResult("3")).toThrow();
  });
});

describe("readReplayResult", () => {
  // An older engine answers with a bare boolean; `false` must not read as success.
  test("reads an older engine's boolean answer", () => {
    expect(readReplayResult(true)).toEqual({ ok: true });
    expect(readReplayResult(false)).toEqual({ ok: false, reason: LEGACY_REPLAY_REFUSAL });
  });

  test("reads the current answer", () => {
    expect(readReplayResult({ ok: true, replayEnvelopeId: "env-2" })).toEqual({
      ok: true,
      replayEnvelopeId: "env-2",
      reason: undefined,
    });
    expect(readReplayResult({ ok: false, reason: "no overlay is open" }).ok).toBe(false);
  });

  test("rejects anything else", () => {
    expect(() => readReplayResult(undefined)).toThrow();
    expect(() => readReplayResult({ replayed: true })).toThrow();
  });
});
