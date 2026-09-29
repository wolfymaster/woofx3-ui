import { describe, expect, test } from "bun:test";
import { clearResultToast, replayResultToast, skipResultToast } from "./alert-queue";

describe("skipResultToast", () => {
  test("counts what was skipped", () => {
    expect(skipResultToast({ ok: true, skipped: 1 }).title).toBe("Skipped 1 alert");
    expect(skipResultToast({ ok: true, skipped: 2 }).title).toBe("Skipped 2 alerts");
  });

  test("says nothing was playing rather than reporting a failure", () => {
    const toast = skipResultToast({ ok: true, skipped: 0 });
    expect(toast.title).toBe("Nothing is playing");
    expect(toast.variant).toBeUndefined();
  });

  test("tells the creator to open the overlay when none is open", () => {
    const toast = skipResultToast({ ok: false, skipped: 0, reason: "no overlay is open" });
    expect(toast.title).toBe("No overlay is open");
    expect(toast.description).toContain("browser source");
    expect(toast.variant).toBe("destructive");
  });

  test("passes any other refusal through as a sentence", () => {
    const toast = skipResultToast({ ok: false, skipped: 0, reason: "the scene manager did not answer: timeout" });
    expect(toast.title).toBe("Could not skip the alert");
    expect(toast.description).toBe("The scene manager did not answer: timeout.");
  });
});

describe("clearResultToast", () => {
  test("pluralises the dropped count", () => {
    expect(clearResultToast({ ok: true, cleared: 1 }).description).toContain("1 waiting alert.");
    expect(clearResultToast({ ok: true, cleared: 12 }).description).toContain("12 waiting alerts.");
  });

  test("reports an already-empty queue", () => {
    expect(clearResultToast({ ok: true, cleared: 0 }).title).toBe("Queue already empty");
  });

  test("reports a refusal", () => {
    expect(clearResultToast({ ok: false, cleared: 0, reason: "no overlay is open" }).title).toBe("No overlay is open");
    expect(clearResultToast({ ok: false, cleared: 0 }).description).toBe("The engine gave no reason.");
  });
});

describe("replayResultToast", () => {
  test("confirms a replay the engine took", () => {
    expect(replayResultToast({ ok: true, replayEnvelopeId: "e" }).title).toBe("Replaying");
  });

  test("never reads a refusal as success", () => {
    const toast = replayResultToast({ ok: false, reason: "the engine no longer has this alert" });
    expect(toast.title).toBe("Nothing to replay");
    expect(toast.variant).toBe("destructive");
  });

  test("names a missing overlay", () => {
    expect(replayResultToast({ ok: false, reason: "no overlay is open" }).title).toBe("No overlay is open");
  });
});
