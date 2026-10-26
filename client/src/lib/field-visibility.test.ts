import { describe, expect, test } from "bun:test";
import { applyVisibilityChange, dropHiddenValues, isFieldShown } from "./field-visibility";

const COLOR = { id: "color", visibleWhen: { field: "platform", oneOf: ["origin", "all", "twitch"] } };
const PLAIN = { id: "platform" };
const FIELDS = [PLAIN, COLOR];

describe("isFieldShown", () => {
  test("test_is_field_shown_per_controller_value", () => {
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ["listed value", { platform: "origin" }, true],
      ["another listed value", { platform: "twitch" }, true],
      ["unlisted value", { platform: "kick" }, false],
      ["unset controller", {}, false],
      ["variable reference", { platform: "${trigger.platform}" }, true],
      ["padded variable reference", { platform: "  ${trigger.platform}" }, true],
      ["null (Any)", { platform: null }, false],
    ];
    for (const [name, values, shown] of cases) {
      expect({ name, shown: isFieldShown(COLOR, values) }).toEqual({ name, shown });
    }
  });

  test("test_is_field_shown_without_condition_always", () => {
    expect(isFieldShown(PLAIN, {})).toBe(true);
  });
});

describe("dropHiddenValues", () => {
  test("test_drop_hidden_values_removes_hidden_field_only", () => {
    expect(dropHiddenValues(FIELDS, { platform: "kick", color: "#ff0000" })).toEqual({ platform: "kick" });
  });

  test("test_drop_hidden_values_keeps_visible_field", () => {
    const values = { platform: "all", color: "#ff0000" };
    expect(dropHiddenValues(FIELDS, values)).toEqual(values);
  });

  test("test_drop_hidden_values_does_not_mutate_input", () => {
    const values = { platform: "kick", color: "#ff0000" };
    dropHiddenValues(FIELDS, values);
    expect(values.color).toBe("#ff0000");
  });
});

describe("applyVisibilityChange", () => {
  const defaultFor = () => "#9146ff";

  test("test_apply_visibility_change_hiding_drops_value", () => {
    const before = { platform: "twitch", color: "#ff0000" };
    expect(applyVisibilityChange(FIELDS, before, { ...before, platform: "kick" }, defaultFor)).toEqual({
      platform: "kick",
    });
  });

  test("test_apply_visibility_change_showing_restores_default", () => {
    expect(applyVisibilityChange(FIELDS, { platform: "kick" }, { platform: "twitch" }, defaultFor)).toEqual({
      platform: "twitch",
      color: "#9146ff",
    });
  });

  test("test_apply_visibility_change_staying_visible_keeps_edit", () => {
    const before = { platform: "twitch", color: "#ff0000" };
    expect(applyVisibilityChange(FIELDS, before, { ...before, platform: "all" }, defaultFor)).toEqual({
      platform: "all",
      color: "#ff0000",
    });
  });

  test("test_apply_visibility_change_variable_controller_shows_field", () => {
    const out = applyVisibilityChange(FIELDS, { platform: "kick" }, { platform: "${trigger.platform}" }, defaultFor);
    expect(out.color).toBe("#9146ff");
  });
});
