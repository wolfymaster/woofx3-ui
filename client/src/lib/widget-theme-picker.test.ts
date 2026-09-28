import { describe, expect, test } from "bun:test";
import type { WidgetThemeOption } from "@convex/lib/widgetThemes";
import {
  DEFAULT_THEME_VALUE,
  isThemeField,
  themeMismatchNotice,
  themePickerOptions,
  themePickerValue,
  themeSelection,
  themeSettingValue,
} from "./widget-theme-picker";

function theme(id: string, name: string, compatible = true): WidgetThemeOption {
  return {
    id,
    name,
    description: "",
    moduleId: id.split(":")[0] ?? "",
    moduleVersion: "1.0.0",
    contractVersion: 1,
    compatible,
    previewUrl: null,
  };
}

const neon = theme("neonpack:theme:neon", "Neon");
const retro = theme("retropack:theme:retro", "Retro", false);

describe("isThemeField", () => {
  test("matches only the theme type", () => {
    expect(isThemeField({ type: "theme" })).toBe(true);
    expect(isThemeField({ type: "select" })).toBe(false);
  });
});

describe("themePickerOptions", () => {
  test("offers Default first, then only compatible themes in list order", () => {
    expect(themePickerOptions([neon, retro])).toEqual([
      { value: DEFAULT_THEME_VALUE, label: "Default" },
      { value: "neonpack:theme:neon", label: "Neon" },
    ]);
  });

  test("offers only Default when nothing targets the widget", () => {
    expect(themePickerOptions([])).toEqual([{ value: DEFAULT_THEME_VALUE, label: "Default" }]);
  });
});

describe("themeSelection", () => {
  test("an unset or empty value is the default look", () => {
    expect(themeSelection(undefined, [neon])).toEqual({ kind: "default" });
    expect(themeSelection("", [neon])).toEqual({ kind: "default" });
    expect(themeSelection(42, [neon])).toEqual({ kind: "default" });
  });

  test("a stored compatible theme is selected", () => {
    expect(themeSelection("neonpack:theme:neon", [neon, retro])).toEqual({ kind: "selected", theme: neon });
  });

  test("a stored theme no longer installed is missing", () => {
    expect(themeSelection("gonepack:theme:gone", [neon])).toEqual({ kind: "missing", themeId: "gonepack:theme:gone" });
  });

  test("a stored theme that no longer fits the contract is incompatible", () => {
    expect(themeSelection("retropack:theme:retro", [neon, retro])).toEqual({ kind: "incompatible", theme: retro });
  });
});

describe("themeMismatchNotice", () => {
  test("says nothing when the overlay shows what is stored", () => {
    expect(themeMismatchNotice({ kind: "default" })).toBeNull();
    expect(themeMismatchNotice({ kind: "selected", theme: neon })).toBeNull();
  });

  test("explains that the overlay renders defaults for a missing or incompatible theme", () => {
    expect(themeMismatchNotice({ kind: "missing", themeId: "gonepack:theme:gone" })).toContain("no longer installed");
    expect(themeMismatchNotice({ kind: "incompatible", theme: retro })).toContain('"Retro" does not fit');
  });
});

describe("picker value round trip", () => {
  test("Default maps to the sentinel and back to unset", () => {
    expect(themePickerValue({ kind: "default" })).toBe(DEFAULT_THEME_VALUE);
    expect(themeSettingValue(DEFAULT_THEME_VALUE)).toBeUndefined();
  });

  test("a theme maps to its canonical id both ways", () => {
    expect(themePickerValue({ kind: "selected", theme: neon })).toBe("neonpack:theme:neon");
    expect(themeSettingValue("neonpack:theme:neon")).toBe("neonpack:theme:neon");
  });

  test("a mismatched value shows no selection", () => {
    expect(themePickerValue({ kind: "incompatible", theme: retro })).toBe("");
    expect(themePickerValue({ kind: "missing", themeId: "x:theme:y" })).toBe("");
  });
});
