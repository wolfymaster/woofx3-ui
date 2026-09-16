import { describe, expect, test } from "bun:test";
import { type PinHistoryEntry, planRepin } from "./pinStrategy";

const STREAM_START = 2_000_000;

function entry(overrides: Partial<PinHistoryEntry> = {}): PinHistoryEntry {
  return {
    twitchMessageId: "msg-1",
    createdAt: STREAM_START + 1_000,
    content: "follow the raid target",
    ...overrides,
  };
}

describe("planRepin", () => {
  test("re-pins the original when the entry was created during this stream", () => {
    expect(planRepin(entry(), STREAM_START)).toEqual({ kind: "repin", messageId: "msg-1" });
  });

  test("re-posts the text when the entry predates this stream, without spending a doomed call", () => {
    expect(planRepin(entry({ createdAt: STREAM_START - 1 }), STREAM_START)).toEqual({
      kind: "resend",
      text: "follow the raid target",
    });
  });

  test("an entry created exactly at the stream start still belongs to it", () => {
    expect(planRepin(entry({ createdAt: STREAM_START }), STREAM_START)).toEqual({
      kind: "repin",
      messageId: "msg-1",
    });
  });

  test("re-posts the text for a hand-written entry that never had a message id", () => {
    expect(planRepin(entry({ twitchMessageId: undefined }), STREAM_START)).toEqual({
      kind: "resend",
      text: "follow the raid target",
    });
  });

  test("tries the id when the stream boundary is unknown rather than duplicating a live message", () => {
    expect(planRepin(entry(), undefined)).toEqual({ kind: "repin", messageId: "msg-1" });
  });

  test("still re-posts with no id even when the stream boundary is unknown", () => {
    expect(planRepin(entry({ twitchMessageId: undefined }), undefined)).toEqual({
      kind: "resend",
      text: "follow the raid target",
    });
  });

  test("carries the text through verbatim, including newlines", () => {
    const plan = planRepin(entry({ twitchMessageId: undefined, content: "line one\nline two" }), STREAM_START);
    expect(plan).toEqual({ kind: "resend", text: "line one\nline two" });
  });

  test("an empty message id is treated as absent rather than pinned", () => {
    expect(planRepin(entry({ twitchMessageId: "" }), STREAM_START)).toEqual({
      kind: "resend",
      text: "follow the raid target",
    });
  });
});
