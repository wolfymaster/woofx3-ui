import { describe, expect, test } from "bun:test";
import { isUnconfirmedWrite, readHelixResult, unconfirmedResponse } from "./twitch-helix-answer";

async function answered(result: unknown): Promise<{ status: number; body: string; unconfirmed: boolean }> {
  const answer = readHelixResult(result);
  if (answer.kind !== "answer") {
    throw new Error(`expected an answer, got ${answer.kind}`);
  }
  return {
    status: answer.response.status,
    body: await answer.response.text(),
    unconfirmed: isUnconfirmedWrite(answer.response),
  };
}

describe("readHelixResult", () => {
  const answers: Array<{ name: string; result: unknown; status: number; body: string }> = [
    {
      name: "a body is a 200 with it as JSON",
      result: { ok: true, body: { data: [1] } },
      status: 200,
      body: '{"data":[1]}',
    },
    { name: "no body is a 204", result: { ok: true, body: null }, status: 204, body: "" },
    {
      name: "Twitch's refusal keeps its status and body",
      result: { ok: false, code: "helix", error: "x", status: 404, body: '{"message":"no"}' },
      status: 404,
      body: '{"message":"no"}',
    },
    {
      name: "Twitch's empty refusal has no body",
      result: { ok: false, code: "helix", error: "x", status: 403, body: "" },
      status: 403,
      body: "",
    },
  ];
  for (const { name, result, status, body } of answers) {
    test(name, async () => {
      expect(await answered(result)).toEqual({ status, body, unconfirmed: false });
    });
  }

  test("a timeout or failure is unconfirmed", () => {
    expect(readHelixResult({ ok: false, code: "timeout", error: "slow" })).toEqual({
      kind: "unconfirmed",
      reason: "timeout",
      error: "slow",
    });
    expect(readHelixResult({ ok: false, code: "failed", error: "boom" })).toEqual({
      kind: "unconfirmed",
      reason: "failed",
      error: "boom",
    });
  });

  test("a call the engine never sent is refused with its code", () => {
    for (const code of ["invalid_arguments", "not_linked", "unavailable"] as const) {
      expect(readHelixResult({ ok: false, code, error: "why" })).toEqual({ kind: "refused", code, error: "why" });
    }
  });

  const unreadable: Array<{ name: string; result: unknown }> = [
    { name: "not an object", result: "yes" },
    { name: "null", result: null },
    { name: "no ok flag", result: { body: {} } },
    {
      name: "a helix refusal with a success status",
      result: { ok: false, code: "helix", error: "", status: 200, body: "" },
    },
    { name: "a helix refusal past 599", result: { ok: false, code: "helix", error: "", status: 600, body: "" } },
    { name: "a helix refusal without a body", result: { ok: false, code: "helix", error: "", status: 500 } },
  ];
  for (const { name, result } of unreadable) {
    test(`an unreadable result (${name}) is an unconfirmed failure`, () => {
      expect(readHelixResult(result)).toMatchObject({ kind: "unconfirmed", reason: "failed" });
    });
  }
});

describe("unconfirmedResponse", () => {
  test("is a 5xx marked unconfirmed", () => {
    expect(unconfirmedResponse("timeout").status).toBe(504);
    expect(unconfirmedResponse("failed").status).toBe(502);
    expect(isUnconfirmedWrite(unconfirmedResponse("failed"))).toBe(true);
    expect(isUnconfirmedWrite(new Response(null, { status: 502 }))).toBe(false);
  });
});
