import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { SIGNATURE_TOLERANCE_SECONDS, verifySignature } from "./maintenanceSignature";

const SECRET = "whsec_maintenance_test";
const NOW = new Date("2026-09-19T12:00:00.000Z");

/** The sender's side, kept independent of the implementation under test. */
function sign(body: string, secret: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

describe("verifySignature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "engine.ready", occurredAt: NOW.toISOString() });

  it("accepts a signature made with the same secret over the same body", async () => {
    expect(await verifySignature(body, sign(body, SECRET, NOW), SECRET, NOW)).toEqual({
      valid: true,
      timestamp: Math.floor(NOW.getTime() / 1000),
    });
  });

  it("accepts a header carrying several v1 entries, as a secret rotation sends", async () => {
    const header = `${sign(body, "old-secret", NOW)},v1=${sign(body, SECRET, NOW).split("v1=")[1]}`;
    expect((await verifySignature(body, header, SECRET, NOW)).valid).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    expect(await verifySignature(body, sign(body, "other-secret", NOW), SECRET, NOW)).toEqual({
      valid: false,
      reason: "signature mismatch",
    });
  });

  it("rejects a body altered after signing", async () => {
    const header = sign(body, SECRET, NOW);
    const tampered = body.replace("engine.ready", "engine.failed");
    expect(await verifySignature(tampered, header, SECRET, NOW)).toEqual({
      valid: false,
      reason: "signature mismatch",
    });
  });

  // The timestamp is inside the MAC, so a replayed capture keeps its original
  // `t` and ages out; this is the check that makes the capture window short.
  it("rejects a timestamp outside the tolerance, in either direction", async () => {
    const stale = new Date(NOW.getTime() - (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000);
    const future = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000);
    expect(await verifySignature(body, sign(body, SECRET, stale), SECRET, NOW)).toEqual({
      valid: false,
      reason: "timestamp outside tolerance",
    });
    expect(await verifySignature(body, sign(body, SECRET, future), SECRET, NOW)).toEqual({
      valid: false,
      reason: "timestamp outside tolerance",
    });
  });

  it("accepts a timestamp at the edge of the tolerance", async () => {
    const edge = new Date(NOW.getTime() - SIGNATURE_TOLERANCE_SECONDS * 1000);
    expect((await verifySignature(body, sign(body, SECRET, edge), SECRET, NOW)).valid).toBe(true);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await verifySignature(body, null, SECRET, NOW)).toEqual({ valid: false, reason: "missing signature" });
    expect(await verifySignature(body, "", SECRET, NOW)).toEqual({ valid: false, reason: "missing signature" });
    expect(await verifySignature(body, "v1=deadbeef", SECRET, NOW)).toEqual({
      valid: false,
      reason: "malformed signature",
    });
    expect(await verifySignature(body, `t=${Math.floor(NOW.getTime() / 1000)}`, SECRET, NOW)).toEqual({
      valid: false,
      reason: "malformed signature",
    });
    // Not 64 hex characters, so it is not a candidate MAC at all.
    expect(await verifySignature(body, `t=${Math.floor(NOW.getTime() / 1000)},v1=nothex`, SECRET, NOW)).toEqual({
      valid: false,
      reason: "malformed signature",
    });
  });
});
