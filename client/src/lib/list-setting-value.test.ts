import { describe, expect, test } from "bun:test";
import { listRows } from "./list-field-rows";
import { listSettingText, listSettingValue } from "./list-setting-value";

describe("list setting values", () => {
  test("stored rows read back as the same rows", () => {
    const rows = [{ label: "Pizza" }, { label: "Tacos" }];
    expect(listSettingValue(listSettingText(rows))).toEqual(rows);
  });

  test("an unset list reads as no rows", () => {
    expect(listSettingValue("")).toEqual([]);
    expect(listSettingValue("[]")).toEqual([]);
  });

  test("text from before the setting was a list reads as one row per entry", () => {
    expect(listRows(listSettingValue("Pizza, Tacos"), "label")).toEqual([{ label: "Pizza" }, { label: "Tacos" }]);
  });

  test("anything but rows saves as an empty list", () => {
    expect(listSettingText(undefined)).toBe("[]");
    expect(listSettingText("Pizza")).toBe("[]");
  });
});
