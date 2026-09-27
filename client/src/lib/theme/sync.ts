import { $resolvedThemeMode, $systemPrefersDark, $themeColors, SYSTEM_DARK_QUERY } from "./store";
import { changedThemeTokens, resolveThemeTokens } from "./tokens";

let started = false;

/**
 * Keeps `<html>` in step with the theme stores: the `dark` class (for Tailwind
 * `dark:` variants and the mode-only variables in index.css), `color-scheme`
 * (native scrollbars and form controls), and every palette color variable as
 * an inline style, which outranks the stylesheet defaults.
 *
 * This is the only writer of theme state to `<html>`; `useTheme` just reads and
 * sets the stores. Call once, before the first render.
 */
export function startThemeSync(): void {
  if (started) {
    throw new Error("startThemeSync called more than once");
  }
  started = true;
  const root = document.documentElement;

  window.matchMedia(SYSTEM_DARK_QUERY).addEventListener("change", (event) => {
    $systemPrefersDark.set(event.matches);
  });

  $resolvedThemeMode.subscribe((mode) => {
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
  });

  let applied: Record<string, string> = {};
  $themeColors.subscribe((colors) => {
    const tokens = resolveThemeTokens(colors);
    for (const [name, value] of changedThemeTokens(applied, tokens)) {
      root.style.setProperty(name, value);
    }
    applied = tokens;
  });
}
