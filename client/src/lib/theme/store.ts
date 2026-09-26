import { atom, computed } from "nanostores";
import { getStoredValue, persistValue } from "@/lib/stores";
import type { ThemeColorKey, ThemeMode } from "./palettes";
import {
  CUSTOM_PALETTE_ID,
  type CustomTheme,
  EMPTY_CUSTOM_THEME,
  hasCustomOverrides,
  parseCustomTheme,
  parsePaletteId,
  parseThemeModePreference,
  resolveMode,
  resolveThemeColors,
  type ThemeModePreference,
} from "./resolve";

// The mode key is also read by the pre-paint script in client/index.html.
const STORAGE_KEYS = {
  mode: "streamdeck-theme",
  palette: "woofx3-theme-palette",
  custom: "woofx3-theme-custom",
};

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

export const $themeMode = atom<ThemeModePreference>(
  parseThemeModePreference(getStoredValue<unknown>(STORAGE_KEYS.mode, null))
);
export const $themePaletteId = atom<string>(parsePaletteId(getStoredValue<unknown>(STORAGE_KEYS.palette, null)));
export const $customTheme = atom<CustomTheme>(parseCustomTheme(getStoredValue<unknown>(STORAGE_KEYS.custom, null)));
export const $systemPrefersDark = atom<boolean>(readSystemPrefersDark());

$themeMode.subscribe((value) => persistValue(STORAGE_KEYS.mode, value));
$themePaletteId.subscribe((value) => persistValue(STORAGE_KEYS.palette, value));
$customTheme.subscribe((value) => persistValue(STORAGE_KEYS.custom, value));

export const $resolvedThemeMode = computed([$themeMode, $systemPrefersDark], resolveMode);

export const $themeColors = computed([$themePaletteId, $customTheme, $resolvedThemeMode], resolveThemeColors);

export function setThemeMode(mode: ThemeModePreference): void {
  $themeMode.set(mode);
}

/** Flips what is on screen, pinning the choice even if it was following the system. */
export function toggleThemeMode(): void {
  $themeMode.set($resolvedThemeMode.get() === "dark" ? "light" : "dark");
}

/**
 * Choosing Custom with nothing customized yet starts from the palette that was
 * on screen, so the first edit tweaks what the user was looking at.
 */
export function selectThemePalette(paletteId: string): void {
  const current = $themePaletteId.get();
  const custom = $customTheme.get();
  if (paletteId === CUSTOM_PALETTE_ID && current !== CUSTOM_PALETTE_ID && !hasCustomOverrides(custom)) {
    $customTheme.set({ ...custom, baseId: current });
  }
  $themePaletteId.set(parsePaletteId(paletteId));
}

export function setCustomThemeBase(baseId: string): void {
  $customTheme.set(parseCustomTheme({ ...$customTheme.get(), baseId }));
}

export function setCustomThemeColor(mode: ThemeMode, key: ThemeColorKey, hex: string): void {
  const custom = $customTheme.get();
  $customTheme.set(parseCustomTheme({ ...custom, [mode]: { ...custom[mode], [key]: hex } }));
}

export function resetCustomThemeColor(mode: ThemeMode, key: ThemeColorKey): void {
  const custom = $customTheme.get();
  const { [key]: _removed, ...rest } = custom[mode];
  $customTheme.set({ ...custom, [mode]: rest });
}

/** Clears every override in both modes, leaving the custom theme identical to its base. */
export function resetCustomTheme(): void {
  $customTheme.set({ ...EMPTY_CUSTOM_THEME, baseId: $customTheme.get().baseId });
}
