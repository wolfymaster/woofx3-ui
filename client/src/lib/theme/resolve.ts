import { isHexColor } from "./color";
import {
  DEFAULT_PALETTE_ID,
  findPalette,
  getPalette,
  type ThemeColorKey,
  type ThemeColors,
  type ThemeMode,
} from "./palettes";

export type ThemeModePreference = ThemeMode | "system";

/** Palette id meaning "the user's custom colors" rather than a built-in palette. */
export const CUSTOM_PALETTE_ID = "custom";

/**
 * A custom theme is a built-in palette plus per-mode color overrides. Storing
 * overrides rather than a full color set means an unedited color keeps
 * following its base, and resetting a color is deleting its key.
 */
export interface CustomTheme {
  baseId: string;
  light: Partial<ThemeColors>;
  dark: Partial<ThemeColors>;
}

export const EMPTY_CUSTOM_THEME: CustomTheme = { baseId: DEFAULT_PALETTE_ID, light: {}, dark: {} };

const THEME_COLOR_KEYS = new Set<string>(Object.keys(getPalette(DEFAULT_PALETTE_ID).light));

export function isThemeColorKey(key: string): key is ThemeColorKey {
  return THEME_COLOR_KEYS.has(key);
}

export function parseThemeModePreference(value: unknown): ThemeModePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function parsePaletteId(value: unknown): string {
  if (typeof value === "string" && (value === CUSTOM_PALETTE_ID || findPalette(value))) {
    return value;
  }
  return DEFAULT_PALETTE_ID;
}

function parseOverrides(value: unknown): Partial<ThemeColors> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const overrides: Partial<ThemeColors> = {};
  for (const [key, color] of Object.entries(value)) {
    if (isThemeColorKey(key) && typeof color === "string" && isHexColor(color)) {
      overrides[key] = color;
    }
  }
  return overrides;
}

/** Reads a stored custom theme, dropping anything a hand-edited or stale entry got wrong. */
export function parseCustomTheme(value: unknown): CustomTheme {
  if (typeof value !== "object" || value === null) {
    return EMPTY_CUSTOM_THEME;
  }
  const record = value as Record<string, unknown>;
  const baseId = typeof record.baseId === "string" && findPalette(record.baseId) ? record.baseId : DEFAULT_PALETTE_ID;
  return { baseId, light: parseOverrides(record.light), dark: parseOverrides(record.dark) };
}

export function hasCustomOverrides(custom: CustomTheme): boolean {
  return Object.keys(custom.light).length > 0 || Object.keys(custom.dark).length > 0;
}

export function resolveMode(preference: ThemeModePreference, systemPrefersDark: boolean): ThemeMode {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

export function resolveThemeColors(paletteId: string, custom: CustomTheme, mode: ThemeMode): ThemeColors {
  if (paletteId === CUSTOM_PALETTE_ID) {
    return { ...getPalette(custom.baseId)[mode], ...custom[mode] };
  }
  return getPalette(paletteId)[mode];
}
