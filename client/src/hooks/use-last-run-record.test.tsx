import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { describeTestEventOutcome, type RunRecord } from "@/lib/test-event-outcome";
import { useLastRunRecord } from "./use-last-run-record";

/** The outcome a form shows once its wait has elapsed, for each answer `useEvent` gives in turn. */
function outcomesOf(...answers: { key: string | null; record: RunRecord | null | undefined }[]): string[] {
  const kinds: string[] = [];
  function Probe({ answer }: { answer: (typeof answers)[number] }) {
    kinds.push(describeTestEventOutcome(useLastRunRecord(answer.key, answer.record), true).kind);
    return null;
  }
  const [first, ...rest] = answers;
  if (first === undefined) {
    throw new Error("outcomesOf needs an answer");
  }
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(<Probe answer={first} />);
  });
  for (const answer of rest) {
    act(() => renderer?.update(<Probe answer={answer} />));
  }
  return kinds;
}

const SUCCESS: RunRecord = { status: "success" };

describe("useLastRunRecord", () => {
  test("a success stays a success once its row expires", () => {
    expect(
      outcomesOf({ key: "t1", record: SUCCESS }, { key: "t1", record: null }, { key: "t1", record: undefined })
    ).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  test("a failure stays a failure once its row expires", () => {
    const failure: RunRecord = { status: "error", message: "nope" };
    expect(outcomesOf({ key: "t1", record: failure }, { key: "t1", record: null })).toEqual(["failed", "failed"]);
  });

  test("a run seen starting is not called unmatched when its row expires", () => {
    expect(outcomesOf({ key: "t1", record: { status: "progress" } }, { key: "t1", record: null })).toEqual([
      "running",
      "running",
    ]);
  });

  test("a record never seen can still be nothing matched", () => {
    expect(outcomesOf({ key: "t1", record: undefined }, { key: "t1", record: null })).toEqual([
      "waiting",
      "nothingMatched",
    ]);
  });

  test("a newer row replaces the one kept", () => {
    expect(outcomesOf({ key: "t1", record: { status: "progress" } }, { key: "t1", record: SUCCESS })).toEqual([
      "running",
      "succeeded",
    ]);
  });

  test("a new key does not inherit the last key's answer", () => {
    expect(
      outcomesOf({ key: "t1", record: SUCCESS }, { key: "t2", record: null }, { key: null, record: undefined })
    ).toEqual(["succeeded", "nothingMatched", "waiting"]);
  });
});
