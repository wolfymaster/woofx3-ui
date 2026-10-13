import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import type { Id } from "../_generated/dataModel";
import {
  ENTITLEMENT_GRANT_TYPE,
  engineNameFor,
  GRANT_LIFETIME_MS,
  grantedCapabilities,
  grantPayload,
  grantSigningInput,
  isCapabilityId,
  isLegacyGrantError,
  nextGrantSeq,
  withheldReason,
} from "./entitlementGrant";
import { parseEntitlementSigningKey, publicKeyEntry, signGrant } from "./entitlementSigning";
import type { FeatureFlagSubject } from "./featureFlags";

const subject: FeatureFlagSubject = {
  accountId: "account1" as Id<"accounts">,
  instanceId: "instance1" as Id<"instances">,
  hosting: "managed",
  licenseFeatures: ["pro"],
};

describe("engineNameFor", () => {
  it("is eng- and the first 8 hex digits of the maintenance engine id", () => {
    expect(engineNameFor("0a1b2c3d-4e5f-6789-abcd-ef0123456789")).toBe("eng-0a1b2c3d");
    expect(() => engineNameFor("not-an-id")).toThrow();
  });
});

describe("grantedCapabilities", () => {
  it("grants rows that are on for the instance, sorted", () => {
    const rows = [
      { capability: "obs.control", state: "rules" as const, rules: { licenseFeature: "pro" } },
      { capability: "analytics.gauges", state: "on" as const },
      { capability: "config.bundles", state: "off" as const },
      { capability: "modules.files", state: "rules" as const, rules: { licenseFeature: "enterprise" } },
    ];
    expect(grantedCapabilities(rows, subject)).toEqual(["analytics.gauges", "obs.control"]);
  });
});

describe("withheldReason", () => {
  it("is plan when a license feature gates the capability, rollout otherwise", () => {
    expect(withheldReason({ capability: "a.b", state: "rules", rules: { licenseFeature: "pro" } })).toBe("plan");
    expect(withheldReason({ capability: "a.b", state: "rules", rules: { percent: 10 } })).toBe("rollout");
    expect(withheldReason(null)).toBe("rollout");
  });
});

describe("nextGrantSeq", () => {
  it("rises with the clock and past the previous seq", () => {
    expect(nextGrantSeq(undefined, 1_000)).toBe(1_000);
    expect(nextGrantSeq(500, 1_000)).toBe(1_000);
    expect(nextGrantSeq(5_000, 1_000)).toBe(5_001);
  });
});

describe("isCapabilityId", () => {
  it("accepts <area>.<feature>", () => {
    expect(isCapabilityId("obs.control")).toBe(true);
    expect(isCapabilityId("workflow.delayWait")).toBe(true);
    expect(isCapabilityId("obs")).toBe(false);
    expect(isCapabilityId("Obs.control")).toBe(false);
  });
});

describe("isLegacyGrantError", () => {
  it("recognises capnweb's refusal of the method", () => {
    expect(isLegacyGrantError(new Error("'setEntitlementGrant' is not a function."))).toBe(true);
    expect(isLegacyGrantError(new Error("Grant has expired"))).toBe(false);
  });
});

describe("signed grants", () => {
  it("produce a compact JWS the engine's WebCrypto verification accepts", async () => {
    const key = parseEntitlementSigningKey("k1", randomBytes(32).toString("base64url"));
    const payload = grantPayload({
      engineName: "eng-0a1b2c3d",
      seq: 7,
      grants: ["obs.control"],
      nowMs: 1_700_000_000_500,
    });
    expect(payload.iat).toBe(1_700_000_000);
    expect(payload.exp - payload.iat).toBe(GRANT_LIFETIME_MS / 1000);

    const token = signGrant(key, grantSigningInput(key.id, payload));
    const [header, body, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "EdDSA",
      kid: "k1",
      typ: ENTITLEMENT_GRANT_TYPE,
    });
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual(payload);

    // Verified as woofx3 api/src/entitlement-grant.ts does: the raw public key from the kid:key entry.
    const [kid, publicKey] = publicKeyEntry(key).split(":") as [string, string];
    expect(kid).toBe("k1");
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(Buffer.from(publicKey, "base64url")),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      verifyKey,
      new Uint8Array(Buffer.from(signature, "base64url")),
      new TextEncoder().encode(`${header}.${body}`)
    );
    expect(valid).toBe(true);
  });

  it("refuses a malformed signing key", () => {
    expect(() => parseEntitlementSigningKey("k1", "short")).toThrow("32-byte");
    expect(() => parseEntitlementSigningKey("bad id!", randomBytes(32).toString("base64url"))).toThrow("KEY_ID");
  });
});
