import { describe, expect, test } from "bun:test";
import { checkEdgeGate, EDGE_SECRET_ENV, EDGE_SECRET_HEADER, EDGE_SECRET_NEXT_ENV } from "./viewerEdgeGate";

const SECRET = "a".repeat(43);
const NEXT = "b".repeat(43);

function headers(secret?: string): Headers {
  return new Headers(secret === undefined ? {} : { [EDGE_SECRET_HEADER]: secret });
}

describe("viewer sign-in edge gate", () => {
  const env = { [EDGE_SECRET_ENV]: SECRET };

  test("lets through a start carrying the edge secret", async () => {
    expect(await checkEdgeGate(headers(SECRET), env)).toEqual({ ok: true });
  });

  test("refuses a start without the header", async () => {
    expect(await checkEdgeGate(headers(), env)).toEqual({ ok: false, refusal: "not_from_edge" });
  });

  test.each([
    ["a wrong secret", "c".repeat(43)],
    ["a prefix of the secret", SECRET.slice(0, 42)],
    ["the secret with more after it", `${SECRET}x`],
    ["an empty header", ""],
  ])("refuses %s", async (_name, presented) => {
    expect(await checkEdgeGate(headers(presented), env)).toEqual({ ok: false, refusal: "not_from_edge" });
  });

  test("accepts either secret while one rotates", async () => {
    const rotating = { [EDGE_SECRET_ENV]: SECRET, [EDGE_SECRET_NEXT_ENV]: NEXT };
    expect(await checkEdgeGate(headers(SECRET), rotating)).toEqual({ ok: true });
    expect(await checkEdgeGate(headers(NEXT), rotating)).toEqual({ ok: true });
    expect(await checkEdgeGate(headers("c".repeat(43)), rotating)).toEqual({ ok: false, refusal: "not_from_edge" });
  });

  test.each([
    ["unset", {}],
    ["empty", { [EDGE_SECRET_ENV]: "" }],
    ["too short", { [EDGE_SECRET_ENV]: "short" }],
    ["set only as the next secret", { [EDGE_SECRET_NEXT_ENV]: NEXT }],
    ["paired with a too-short next secret", { [EDGE_SECRET_ENV]: SECRET, [EDGE_SECRET_NEXT_ENV]: "short" }],
  ])("refuses every start, even one with a matching header, when the secret is %s", async (_name, misconfigured) => {
    const verdict = await checkEdgeGate(headers(SECRET), misconfigured);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.refusal).toBe("not_configured");
  });

  test("a short configured secret never matches a short presented one", async () => {
    const verdict = await checkEdgeGate(headers("short"), { [EDGE_SECRET_ENV]: "short" });
    expect(verdict.ok).toBe(false);
  });
});
