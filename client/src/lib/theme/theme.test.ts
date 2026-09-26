import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio, hexToHslTriple, mixHex, mostReadable } from "./color";
import { DEFAULT_PALETTE_ID, getPalette, themePalettes } from "./palettes";
import {
  CUSTOM_PALETTE_ID,
  parseCustomTheme,
  parsePaletteId,
  parseThemeModePreference,
  resolveMode,
  resolveThemeColors,
} from "./resolve";
import { resolveThemeTokens } from "./tokens";

describe("color", () => {
  test("converts hex to the stylesheet's HSL triple", () => {
    expect(hexToHslTriple("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriple("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriple("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriple("#7c3bed")).toBe("261.9 83.2% 58%");
  });

  test("mixes between two colors", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("picks the candidate with more contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(mostReadable("#fbf1c7", ["#fbf1c7", "#3c3836"])).toBe("#3c3836");
    expect(mostReadable("#1e1e2e", ["#1e1e2e", "#cdd6f4"])).toBe("#cdd6f4");
  });

  test("rejects anything but #rrggbb", () => {
    expect(() => hexToHslTriple("#fff")).toThrow();
    expect(() => hexToHslTriple("red")).toThrow();
  });
});

describe("palettes", () => {
  test("ids are unique and none collide with the custom id", () => {
    const ids = themePalettes.map((palette) => palette.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(CUSTOM_PALETTE_ID);
  });

  // Palettes are hand-typed; a slipped digit would only show up as a broken
  // screen in one palette and one mode.
  test("every variant is complete, valid, and has readable text", () => {
    for (const palette of themePalettes) {
      for (const mode of ["light", "dark"] as const) {
        const colors = palette[mode];
        const label = `${palette.id}/${mode}`;
        expect(Object.keys(colors).sort(), label).toEqual(Object.keys(getPalette(DEFAULT_PALETTE_ID).light).sort());
        for (const value of Object.values(colors)) {
          expect(value, label).toMatch(/^#[0-9a-f]{6}$/);
        }
        expect(contrastRatio(colors.foreground, colors.background), label).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.foreground, colors.card), label).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.mutedForeground, colors.background), label).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("resolveThemeTokens", () => {
  // Any color variable the stylesheet declares but the resolver skips would
  // keep its woofx3 default under every other palette.
  test("covers every color variable index.css declares", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
    const darkBlock = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));
    const colorVars = [
      ...darkBlock.matchAll(/^\s*(--[a-z0-9-]+):\s*\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%;/gm),
    ].map((match) => match[1]);
    expect(colorVars.length).toBeGreaterThan(20);
    const tokens = resolveThemeTokens(getPalette(DEFAULT_PALETTE_ID).dark);
    expect(Object.keys(tokens).sort()).toEqual([...new Set(colorVars)].sort());
  });

  test("puts readable text on the primary fill", () => {
    const tokens = resolveThemeTokens({ ...getPalette("gruvbox").dark, primary: "#fabd2f" });
    expect(tokens["--primary-foreground"]).toBe(hexToHslTriple("#282828"));
  });
});

describe("resolve", () => {
  test("falls back to safe defaults for unknown stored values", () => {
    expect(parseThemeModePreference("sepia")).toBe("system");
    expect(parseThemeModePreference("light")).toBe("light");
    expect(parsePaletteId("broadcast-blue")).toBe(DEFAULT_PALETTE_ID);
    expect(parsePaletteId("nord")).toBe("nord");
    expect(parsePaletteId(CUSTOM_PALETTE_ID)).toBe(CUSTOM_PALETTE_ID);
  });

  test("keeps only valid overrides from a stored custom theme", () => {
    const parsed = parseCustomTheme({
      baseId: "nord",
      light: { primary: "#112233", background: "blue", bogus: "#000000" },
      dark: null,
    });
    expect(parsed).toEqual({ baseId: "nord", light: { primary: "#112233" }, dark: {} });
    expect(parseCustomTheme({ baseId: "gone" }).baseId).toBe(DEFAULT_PALETTE_ID);
    expect(parseCustomTheme("garbage").baseId).toBe(DEFAULT_PALETTE_ID);
  });

  test("resolves system mode from the device preference", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });

  test("layers custom overrides over the base palette for the active mode only", () => {
    const custom = { baseId: "nord", light: { primary: "#112233" }, dark: {} };
    const light = resolveThemeColors(CUSTOM_PALETTE_ID, custom, "light");
    expect(light.primary).toBe("#112233");
    expect(light.background).toBe(getPalette("nord").light.background);
    expect(resolveThemeColors(CUSTOM_PALETTE_ID, custom, "dark")).toEqual(getPalette("nord").dark);
    expect(resolveThemeColors("nord", custom, "light")).toEqual(getPalette("nord").light);
  });
});
