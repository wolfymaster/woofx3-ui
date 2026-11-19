import { describe, expect, it } from "bun:test";
import { parseFeatureFlagKeyRequest, parseFeatureFlagRequest } from "./featureFlagRequest";

const valid = {
  key: "scenes.newToolbar",
  description: "The new scene toolbar",
  owner: "ops@woofx3.tv",
  removeBy: "2026-12-31",
  state: "rules",
  rules: { percent: 10 },
};

describe("parseFeatureFlagRequest", () => {
  it("accepts a complete flag, trimmed", () => {
    expect(
      parseFeatureFlagRequest({
        ...valid,
        key: "  scenes.newToolbar  ",
        description: "  The new scene toolbar  ",
      })
    ).toEqual({ ok: true, value: valid });
  });

  it("accepts a fixed state with no rules", () => {
    expect(parseFeatureFlagRequest({ ...valid, state: "on", rules: undefined })).toEqual({
      ok: true,
      value: { ...valid, state: "on", rules: undefined },
    });
  });

  it("keeps every kind of rule", () => {
    const rules = {
      users: ["u1"],
      accounts: ["a1"],
      instances: ["i1"],
      percent: 25,
      hosting: "managed",
      entitlement: "business",
    };
    expect(parseFeatureFlagRequest({ ...valid, rules })).toEqual({ ok: true, value: { ...valid, rules } });
  });

  it("refuses a flag it could not save", () => {
    const refusals: [string, Record<string, unknown>][] = [
      ["a bad key", { key: "Scenes Toolbar" }],
      ["no description", { description: "  " }],
      ["a long description", { description: "x".repeat(201) }],
      ["no owner", { owner: "" }],
      ["a bad date", { removeBy: "soon" }],
      ["a date that does not exist", { removeBy: "2026-02-31" }],
      ["an unknown state", { state: "sometimes" }],
      ["rules without a state", { state: "on", rules: { percent: 5 } }],
      ["a ruleless rules state", { state: "rules", rules: {} }],
      ["a fractional percent", { rules: { percent: 12.5 } }],
      ["a percent over 100", { rules: { percent: 101 } }],
      ["an unknown entitlement", { rules: { entitlement: "nope" } }],
      ["a target that is not an id", { rules: { accounts: ["not an id"] } }],
      ["too many targets", { rules: { users: Array.from({ length: 101 }, (_, i) => `u${i}`) } }],
      ["an unknown hosting", { rules: { hosting: "somewhere" } }],
    ];
    for (const [name, overrides] of refusals) {
      expect({ name, ok: parseFeatureFlagRequest({ ...valid, ...overrides }).ok }).toEqual({ name, ok: false });
    }
    expect(parseFeatureFlagRequest(null).ok).toBe(false);
  });
});

describe("parseFeatureFlagKeyRequest", () => {
  it("takes the key a removal names", () => {
    expect(parseFeatureFlagKeyRequest({ key: "chat.pins" })).toEqual({ ok: true, value: "chat.pins" });
    expect(parseFeatureFlagKeyRequest({ key: " " }).ok).toBe(false);
    expect(parseFeatureFlagKeyRequest({}).ok).toBe(false);
    expect(parseFeatureFlagKeyRequest(null).ok).toBe(false);
  });
});
