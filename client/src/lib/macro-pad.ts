// A macro pad button and its `{{name}}` variables.
//
// The `{{…}}` delimiter is deliberately neither of the project's two existing
// template syntaxes: the Go workflow engine resolves `${…}` (docs/workflow/
// expressions.md) and the shared TS resolver handles `{…}`
// (shared/common/typescript/templates/resolver.ts), and those two are already
// kept disjoint so one string can pass through both untouched. Macro variables
// are a third layer, resolved in the browser at click time — and a macro's
// command text can travel on to the engine afterwards, so a placeholder left
// unfilled here must not read as an engine path that the engine would then try
// to resolve against trigger data that does not exist.

export type MacroActionType = "chat-command" | "trigger-workflow" | "http-request";

export type MacroHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface MacroConfig {
  command?: string;
  workflowId?: string;
  url?: string;
  method?: MacroHttpMethod;
  headers?: Record<string, string>;
  body?: string;
}

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

// Names are restricted to word characters partly for readability and partly
// because a macro's filled-in values ride along in the widget's Convex config
// blob, and Convex rejects object keys beginning with `$` (see dollar-keys.ts).
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Free-text fields a variable may appear in, in the order the prompt should ask
 * for them. `workflowId` and `method` are chosen from pickers rather than typed,
 * so they are deliberately not scanned.
 */
const TEMPLATE_FIELDS: ReadonlyArray<"command" | "url" | "body"> = ["command", "url", "body"];

function templateStrings(config: MacroConfig): string[] {
  const out: string[] = [];
  for (const field of TEMPLATE_FIELDS) {
    const value = config[field];
    if (typeof value === "string") {
      out.push(value);
    }
  }
  for (const value of Object.values(config.headers ?? {})) {
    if (typeof value === "string") {
      out.push(value);
    }
  }
  return out;
}

/**
 * Every distinct `{{name}}` in a macro, in first-appearance order so the prompt
 * asks for them in the order they were authored.
 */
export function extractMacroVariables(config: MacroConfig): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const text of templateStrings(config)) {
    // A fresh regex per string: the shared one is global, and reusing it would
    // carry lastIndex across strings and skip matches.
    const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
    let match = pattern.exec(text);
    while (match !== null) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      match = pattern.exec(text);
    }
  }
  return names;
}

export function hasMacroVariables(config: MacroConfig): boolean {
  return extractMacroVariables(config).length > 0;
}

function substitute(text: string, values: Readonly<Record<string, string>>): string {
  // A name with no supplied value keeps its literal token rather than collapsing
  // to an empty string, so an authoring mistake stays visible instead of quietly
  // sending a half-built command.
  return text.replace(VARIABLE_PATTERN, (token, name: string) => values[name] ?? token);
}

/**
 * The macro's config with every `{{name}}` replaced by the value collected from
 * the user. Only the free-text fields are rewritten; pickers pass through.
 */
export function applyMacroVariables(config: MacroConfig, values: Readonly<Record<string, string>>): MacroConfig {
  const next: MacroConfig = { ...config };
  for (const field of TEMPLATE_FIELDS) {
    const value = config[field];
    if (typeof value === "string") {
      next[field] = substitute(value, values);
    }
  }
  if (config.headers) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = substitute(value, values);
    }
    next.headers = headers;
  }
  return next;
}
