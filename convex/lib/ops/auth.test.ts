import { describe, expect, it } from "bun:test";
import { ACTOR_HEADER, authenticateOps, REASON_HEADER } from "./auth";

const SECRET = "s".repeat(43);
const NEXT = "n".repeat(43);

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

const read = { requireReason: false };
const write = { requireReason: true };

describe("authenticateOps", () => {
  it("refuses everything when no secret is configured", async () => {
    const result = await authenticateOps(
      headers({ Authorization: `Bearer ${SECRET}`, [ACTOR_HEADER]: "ops@example.com" }),
      [undefined, undefined],
      read
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a configured secret shorter than 32 bytes, even when presented", async () => {
    const result = await authenticateOps(
      headers({ Authorization: "Bearer short", [ACTOR_HEADER]: "ops@example.com" }),
      ["short", undefined],
      read
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a missing or wrong secret", async () => {
    expect(await authenticateOps(headers({ [ACTOR_HEADER]: "a" }), [SECRET, undefined], read)).toMatchObject({
      status: 401,
    });
    expect(
      await authenticateOps(
        headers({ Authorization: `Bearer ${NEXT}`, [ACTOR_HEADER]: "a" }),
        [SECRET, undefined],
        read
      )
    ).toMatchObject({ status: 401 });
    expect(
      await authenticateOps(headers({ Authorization: SECRET, [ACTOR_HEADER]: "a" }), [SECRET, undefined], read)
    ).toMatchObject({ status: 401 });
  });

  it("accepts either the current or the next secret", async () => {
    for (const presented of [SECRET, NEXT]) {
      const result = await authenticateOps(
        headers({ Authorization: `Bearer ${presented}`, [ACTOR_HEADER]: " ops@example.com " }),
        [SECRET, NEXT],
        read
      );
      expect(result).toEqual({ ok: true, actor: "ops@example.com", reason: null });
    }
  });

  it("needs an actor, and a reason for writes", async () => {
    const auth = { Authorization: `Bearer ${SECRET}` };
    expect(await authenticateOps(headers(auth), [SECRET, undefined], read)).toMatchObject({
      status: 400,
      code: "actor_required",
    });
    expect(
      await authenticateOps(headers({ ...auth, [ACTOR_HEADER]: "ops@example.com" }), [SECRET, undefined], write)
    ).toMatchObject({ status: 400, code: "reason_required" });
    expect(
      await authenticateOps(
        headers({ ...auth, [ACTOR_HEADER]: "ops@example.com", [REASON_HEADER]: "ticket 12" }),
        [SECRET, undefined],
        write
      )
    ).toEqual({ ok: true, actor: "ops@example.com", reason: "ticket 12" });
  });
});
