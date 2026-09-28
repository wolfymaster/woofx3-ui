// A macro pad button. Its `{{name}}` variables live in
// convex/lib/macroVariables.ts, shared with the remote trigger route.

import type { MacroActionType, MacroConfig } from "@convex/lib/macroVariables";

export {
  applyMacroVariables,
  extractMacroVariables,
  hasMacroVariables,
  type MacroActionType,
  type MacroConfig,
  type MacroHttpMethod,
} from "@convex/lib/macroVariables";

/** A macro's editable fields — everything except its server-assigned id. */
export type MacroInput = Omit<MacroButton, "id">;

export interface MacroButton {
  id: string;
  label: string;
  /** Lucide icon name, resolved through resolveLucideIcon. */
  icon?: string;
  /** Six-digit hex (`#rrggbb`). Undefined leaves the tile in the default card style. */
  color?: string;
  type: MacroActionType;
  config: MacroConfig;
}

/**
 * Default swatches, mid-tone so they stay legible tinting a tile on both the
 * light and dark grounds. Matches the Tailwind 500 values the announcement
 * swatches in broadcast-controls already use.
 */
export const MACRO_COLOR_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#22c55e", label: "Green" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#a855f7", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#64748b", label: "Slate" },
];

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Exactly `#rrggbb`. The tile's background wash is built by appending an alpha
 * pair to the stored value, which only produces a valid color for the six-digit
 * form — so anything else is refused at the input rather than rendering as a
 * broken style.
 */
export function isHexColor(value: string | undefined): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}
