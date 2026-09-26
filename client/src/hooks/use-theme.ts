import { useStore } from "@nanostores/react";
import {
  $customTheme,
  $resolvedThemeMode,
  $themeColors,
  $themeMode,
  $themePaletteId,
  resetCustomTheme,
  resetCustomThemeColor,
  selectThemePalette,
  setCustomThemeBase,
  setCustomThemeColor,
  setThemeMode,
  toggleThemeMode,
} from "@/lib/theme/store";

/** Reads and changes the theme. Applying it to the page is `startThemeSync`'s job. */
export function useTheme() {
  return {
    /** The user's choice, which may be "system". */
    modePreference: useStore($themeMode),
    /** What is on screen right now. */
    mode: useStore($resolvedThemeMode),
    paletteId: useStore($themePaletteId),
    colors: useStore($themeColors),
    customTheme: useStore($customTheme),
    setMode: setThemeMode,
    toggleMode: toggleThemeMode,
    selectPalette: selectThemePalette,
    setCustomBase: setCustomThemeBase,
    setCustomColor: setCustomThemeColor,
    resetCustomColor: resetCustomThemeColor,
    resetCustomTheme,
  };
}
