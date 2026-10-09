// A macro's `{{name}}` variables.
//
// The `{{…}}` delimiter is deliberately neither of the project's two existing
// template syntaxes: the Go workflow engine resolves `${…}` (docs/workflow/
// expressions.md) and the shared TS resolver handles `{…}`
// (shared/common/typescript/templates/resolver.ts), and those two are already
// kept disjoint so one string can pass through both untouched. Macro variables
// are a third layer, resolved when the macro runs — and a macro's command text
// can travel on to the engine afterwards, so a placeholder left unfilled here
// must not read as an engine path that the engine would then try to resolve
// against trigger data that does not exist.
//
// Lives under convex/ because both sides resolve variables: Convex for a remote
// trigger and for macros it runs against the engine, the browser for an HTTP
// request button.

export type MacroActionType = "send-message" | "chat-command" | "trigger-workflow" | "http-request" | "run-action";

export type MacroHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * The catalog action a "run-action" button runs: the engine's ActionStep, with
 * `$ref` stored as `ref` because Convex rejects field names starting with `$`.
 * `parameters` is stored with its own `$` keys escaped (see dollarKeys.ts).
 */
export interface MacroActionStep {
  /** The engine handler, e.g. `function` or `alert`. */
  action: string;
  /** The canonical function id when `action` is `function`. */
  function?: string;
  /** The catalog entry the step was picked from, for finding its settings again. */
  ref?: string;
  parameters?: Record<string, unknown>;
}

export interface MacroConfig {
  /** Sent to chat verbatim by a "send-message" button. */
  message?: string;
  /**
   * A "chat-command" button's command word, without the `!`. An older button
   * may instead hold a whole typed line such as `!so {{channel}}`, in which
   * case `commandText` is absent.
   */
  command?: string;
  /** What follows the command word, as a chatter would type it after `!command`. */
  commandText?: string;
  workflowId?: string;
  url?: string;
  method?: MacroHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  actionStep?: MacroActionStep;
}

// Names are restricted to word characters partly for readability and partly
// because a macro's filled-in values ride along in the widget's Convex config
// blob, and Convex rejects object keys beginning with `$` (see dollar-keys.ts).
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const VARIABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function isMacroVariableName(name: string): boolean {
  return VARIABLE_NAME_PATTERN.test(name);
}

/**
 * Free-text fields a variable may appear in, in the order the prompt should ask
 * for them. `workflowId` and `method` are chosen from pickers rather than typed,
 * so they are deliberately not scanned; an action's settings are scanned after
 * these, in templateStrings. `command` is scanned because an older
 * button can hold a whole typed `!word rest` line there.
 */
const TEMPLATE_FIELDS: ReadonlyArray<"message" | "command" | "commandText" | "url" | "body"> = [
  "message",
  "command",
  "commandText",
  "url",
  "body",
];

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
  collectStrings(config.actionStep?.parameters, out);
  return out;
}

/**
 * Every string inside an action's settings, however deeply nested: a setting
 * may be a list or an object (an alert layout) whose text carries a variable.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, out);
    }
  }
}

function substituteDeep(value: unknown, values: Readonly<Record<string, string>>): unknown {
  if (typeof value === "string") {
    return substitute(value, values);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDeep(item, values));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteDeep(item, values);
    }
    return out;
  }
  return value;
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
  if (config.actionStep?.parameters) {
    next.actionStep = {
      ...config.actionStep,
      parameters: substituteDeep(config.actionStep.parameters, values) as Record<string, unknown>,
    };
  }
  return next;
}
