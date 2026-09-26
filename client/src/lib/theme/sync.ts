import { $resolvedThemeMode, $systemPrefersDark, $themeColors, SYSTEM_DARK_QUERY } from "./store";
import { resolveThemeTokens } from "./tokens";

/**
 * Keeps `<html>` in step with the theme stores: the `dark` class (for Tailwind
 * `dark:` variants and the mode-only variables in index.css), `color-scheme`
 * (native scrollbars and form controls), and every palette color variable as
 * an inline style, which outranks the stylesheet defaults.
 *
 * Call once, before the first render.
 */
export function startThemeSync(): void {
  const root = document.documentElement;

  window.matchMedia(SYSTEM_DARK_QUERY).addEventListener("change", (event) => {
    $systemPrefersDark.set(event.matches);
  });

  $resolvedThemeMode.subscribe((mode) => {
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
  });

  $themeColors.subscribe((colors) => {
    for (const [name, value] of Object.entries(resolveThemeTokens(colors))) {
      root.style.setProperty(name, value);
    }
  });
}
