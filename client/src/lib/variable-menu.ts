import { EXPRESSION_FUNCTION_HELP, type ExpressionFunctionHelp } from "@/lib/expression-functions";
import type { VariableNames } from "@/lib/variable-display";
import type { VariableOption } from "@/lib/workflow-variables";

export interface VariableMenuItem {
  option: VariableOption;
  /** The short name the field shows and inserts, without braces. */
  name: string;
  /** Set on a function's row, which inserts a call rather than a reference. */
  callable?: ExpressionFunctionHelp;
}

/**
 * Where the cursor sits in an unclosed "{…": what a chosen item replaces (`start`..`end`)
 * and the text it is searched by. `argument` is inside a function call's parentheses,
 * where a choice goes in bare, without braces of its own.
 */
export interface TypedReference {
  start: number;
  end: number;
  query: string;
  argument: boolean;
}

/**
 * The reference being typed at `cursor`, if any. A "}" or newline between the "{" and
 * the cursor means it's already closed (or the user moved on). With `functions`, the
 * text after a "(" is an argument, searched by the word at the cursor; past its closing
 * ")" or inside a quoted string there is nothing to suggest.
 */
export function findTypedReference(text: string, cursor: number, functions: boolean): TypedReference | null {
  const uptoCursor = text.slice(0, cursor);
  const brace = uptoCursor.lastIndexOf("{");
  if (brace === -1) {
    return null;
  }
  const since = uptoCursor.slice(brace + 1);
  if (since.includes("}") || since.includes("\n")) {
    return null;
  }
  if (functions && since.includes("(")) {
    return findTypedArgument(since, cursor);
  }
  // A "{" among a call's arguments starts another argument, which is written without braces.
  const outer = uptoCursor.lastIndexOf("{", brace - 1);
  if (functions && brace > 0 && outer !== -1 && findTypedArgument(uptoCursor.slice(outer + 1, brace), brace) !== null) {
    return { start: brace, end: cursor, query: since, argument: true };
  }
  // Someone used to the engine's syntax types "${"; the "$" goes with the reference it opens.
  const start = brace > 0 && uptoCursor[brace - 1] === "$" ? brace - 1 : brace;
  return { start, end: cursor, query: since, argument: false };
}

function findTypedArgument(since: string, cursor: number): TypedReference | null {
  let depth = 0;
  let quote: string | null = null;
  for (const c of since) {
    if (quote !== null) {
      quote = c === quote ? null : quote;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    }
  }
  if (quote !== null || depth <= 0) {
    return null;
  }
  const query = /[A-Za-z0-9_.-]*$/.exec(since)?.[0] ?? "";
  return { start: cursor - query.length, end: cursor, query, argument: true };
}

/** The functions matching `query`, as a menu group of their own, or nothing when none do. */
export function functionMenuGroup(query: string): VariableMenuGroup[] {
  const q = query.trim().toLowerCase();
  const items = EXPRESSION_FUNCTION_HELP.filter((help) => help.name.includes(q)).map(
    (help): VariableMenuItem => ({
      name: help.name,
      callable: help,
      option: { value: `function:${help.name}`, label: help.name, group: "Functions", description: help.description },
    })
  );
  return items.length > 0 ? [{ group: "Functions", items }] : [];
}

export interface VariableMenuGroup {
  group: string;
  items: VariableMenuItem[];
}

/**
 * The variables matching `query`, grouped by where they come from, best matches first.
 *
 * Only the name, the label and the group are searched. Descriptions and types are
 * left out: they are prose and type tokens, so a short query like "user" or "str"
 * would match nearly every row and bury the variable being typed.
 *
 * Groups keep their workflow order until a query ranks one ahead of another, so an
 * empty query reads trigger first, then each step in the order it runs.
 */
export function variableMenuGroups(
  options: readonly VariableOption[],
  names: VariableNames,
  query: string
): VariableMenuGroup[] {
  const q = query.trim().toLowerCase();
  const scored: { item: VariableMenuItem; score: number; order: number }[] = [];
  options.forEach((option, order) => {
    const name = names.nameByToken.get(option.value) ?? option.value;
    const score = matchScore(q, name, option);
    if (score !== null) {
      scored.push({ item: { option, name }, score, order });
    }
  });

  const byGroup = new Map<string, { best: number; order: number; entries: typeof scored }>();
  for (const entry of scored) {
    const existing = byGroup.get(entry.item.option.group);
    if (existing) {
      existing.best = Math.min(existing.best, entry.score);
      existing.entries.push(entry);
    } else {
      byGroup.set(entry.item.option.group, { best: entry.score, order: entry.order, entries: [entry] });
    }
  }

  return Array.from(byGroup.entries())
    .sort(([, a], [, b]) => a.best - b.best || a.order - b.order)
    .map(([group, { entries }]) => ({
      group,
      items: entries.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.item),
    }));
}

/** Lower is better; null when the option does not match at all. */
function matchScore(q: string, name: string, option: VariableOption): number | null {
  if (!q) {
    return 0;
  }
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith(q)) {
    return 0;
  }
  if (lowerName.includes(q)) {
    return 1;
  }
  if (option.label.toLowerCase().includes(q)) {
    return 2;
  }
  if (option.group.toLowerCase().includes(q)) {
    return 3;
  }
  return null;
}

/** The menu's items in the order they are shown, which is the order the arrow keys walk. */
export function flattenVariableMenu(groups: readonly VariableMenuGroup[]): VariableMenuItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * `text` with the range `start`..`end` replaced by a `{name}` reference, and where the
 * cursor belongs afterwards: just past the inserted reference.
 */
export function insertVariableReference(
  text: string,
  start: number,
  end: number,
  name: string
): { text: string; cursor: number } {
  if (start < 0 || end < start || end > text.length) {
    throw new Error(`insert range ${start}..${end} is outside text of length ${text.length}`);
  }
  const reference = `{${name}}`;
  return { text: `${text.slice(0, start)}${reference}${text.slice(end)}`, cursor: start + reference.length };
}

/**
 * `text` with the typed range replaced by the chosen item. A function goes in with
 * empty parentheses and the cursor between them, ready for its first argument.
 */
export function insertMenuItem(
  text: string,
  { start, end, argument }: Pick<TypedReference, "start" | "end" | "argument">,
  item: VariableMenuItem
): { text: string; cursor: number } {
  if (!item.callable && !argument) {
    return insertVariableReference(text, start, end, item.name);
  }
  if (start < 0 || end < start || end > text.length) {
    throw new Error(`insert range ${start}..${end} is outside text of length ${text.length}`);
  }
  const before = `${argument ? "" : "{"}${item.name}${item.callable ? "(" : ""}`;
  const after = `${item.callable ? ")" : ""}${argument ? "" : "}"}`;
  return { text: `${text.slice(0, start)}${before}${after}${text.slice(end)}`, cursor: start + before.length };
}
