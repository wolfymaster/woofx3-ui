/** Apple platforms, whose shortcuts take Command where others take Control. */
const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

/**
 * The modifier a shortcut hint names on this device: the Command glyph on Apple
 * platforms, "Ctrl" elsewhere. Shortcuts listen for either key, so only the hint differs.
 */
export function shortcutModifierLabel(userAgent: string): "⌘" | "Ctrl" {
  return APPLE_PLATFORM.test(userAgent) ? "⌘" : "Ctrl";
}
