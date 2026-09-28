import { describe, expect, test } from "bun:test";
import { declaredSettingsOnly } from "./moduleSettingsVisibility";

const stored = [
  { key: "clientId", value: "abc" },
  { key: "authToken", value: "live-access-token" },
  { key: "refreshToken", value: "live-refresh-token" },
];

describe("declaredSettingsOnly", () => {
  test("keeps only the settings the manifest declares", () => {
    const manifest = {
      settings: [
        { id: "authorizeSpotify", type: "button" },
        { id: "clientId", type: "text" },
      ],
    };
    expect(declaredSettingsOnly(stored, manifest).map((s) => s.key)).toEqual(["clientId"]);
  });

  test("returns nothing when the manifest cannot be read", () => {
    expect(declaredSettingsOnly(stored, null)).toEqual([]);
    expect(declaredSettingsOnly(stored, { settings: "nope" })).toEqual([]);
    expect(declaredSettingsOnly(stored, {})).toEqual([]);
  });

  test("ignores malformed setting entries", () => {
    const manifest = { settings: [null, { id: 3 }, { id: "" }, { id: "clientId" }] };
    expect(declaredSettingsOnly(stored, manifest).map((s) => s.key)).toEqual(["clientId"]);
  });
});
