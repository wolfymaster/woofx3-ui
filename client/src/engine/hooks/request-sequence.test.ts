import { describe, expect, test } from "bun:test";
import { createRequestSequence } from "./request-sequence";

describe("createRequestSequence", () => {
  test("the newest ticket is current", () => {
    const sequence = createRequestSequence();
    const ticket = sequence.next();
    expect(sequence.isCurrent(ticket)).toBe(true);
  });

  test("a newer request makes an earlier ticket stale", () => {
    const sequence = createRequestSequence();
    const first = sequence.next();
    const second = sequence.next();
    expect(sequence.isCurrent(first)).toBe(false);
    expect(sequence.isCurrent(second)).toBe(true);
  });

  test("sequences are independent", () => {
    const a = createRequestSequence();
    const b = createRequestSequence();
    const ticket = a.next();
    b.next();
    b.next();
    expect(a.isCurrent(ticket)).toBe(true);
  });
});
