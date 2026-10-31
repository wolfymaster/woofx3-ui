import { functionCallProblem } from "@woofx3/api/expression";
import { isExpressionFunction } from "@/lib/expression-functions";
import { expressionReferences, rewriteExpressionReferences } from "@/lib/expression-text";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * How variable references read in a text field. The engine needs the full
 * `${trigger.data.user.firstName}`, and that is what gets stored, but a field shows it
 * as `{firstName}`: the last segment of the path, lengthened from the end only as far
 * as it takes to tell two variables apart (`{increment.next}` beside
 * `{increment-2.next}`).
 *
 * A library alert's text refers to the alert's inputs instead, stored as `{{id}}`
 * (see bind.ts in @woofx3/scene), and an option whose value is `{{id}}` is shown as
 * `{id}` the same way. An input id is one name, never shortened.
 *
 * Only a reference to a variable in `options` is shortened. Anything else inside
 * `${…}` or `{{…}}` (a compound expression, a reference to a step that no longer
 * runs first, an input the alert does not declare) stays as typed, so a broken
 * reference is visible rather than disguised.
 *
 * A function call reads the same way: `${round(trigger.data.amount, 2)}` is shown as
 * `{round(amount, 2)}`, with only the references it names shortened.
 */
export interface VariableNames {
  /** Stored token (`${trigger.data.firstName}`) to its short name (`firstName`). */
  nameByToken: ReadonlyMap<string, string>;
  /** Short name to the stored token. */
  tokenByName: ReadonlyMap<string, string>;
}

export function variableNames(options: readonly VariableOption[]): VariableNames {
  const tokens = Array.from(new Set(options.map((option) => option.value)));
  const segmentsByToken = new Map(tokens.map((token) => [token, referenceSegments(token)]));
  const lengths = new Map(tokens.map((token) => [token, 1]));
  const nameOf = (token: string) => {
    const segments = segmentsByToken.get(token) ?? [];
    return segments.slice(-(lengths.get(token) ?? 1)).join(".");
  };

  // Lengthen every name that is still shared until none are. Tokens are distinct, so
  // two names can only stay equal while one of them has segments left to add.
  for (;;) {
    const tokensByName = new Map<string, string[]>();
    for (const token of tokens) {
      const name = nameOf(token);
      tokensByName.set(name, [...(tokensByName.get(name) ?? []), token]);
    }
    let lengthened = false;
    for (const shared of Array.from(tokensByName.values())) {
      if (shared.length < 2) {
        continue;
      }
      for (const token of shared) {
        const length = lengths.get(token) ?? 1;
        if (length < (segmentsByToken.get(token)?.length ?? 1)) {
          lengths.set(token, length + 1);
          lengthened = true;
        }
      }
    }
    if (!lengthened) {
      break;
    }
  }

  const nameByToken = new Map<string, string>();
  const tokenByName = new Map<string, string>();
  for (const token of tokens) {
    const name = nameOf(token);
    if (tokenByName.has(name)) {
      throw new Error(`variable names collide on "${name}"`);
    }
    nameByToken.set(token, name);
    tokenByName.set(name, token);
  }
  return { nameByToken, tokenByName };
}

const VARIABLE_TOKEN = /^\$\{([^{}]*)\}$/;
const INPUT_TOKEN = /^\{\{([A-Za-z0-9_.-]+)\}\}$/;
// A `{{` after a backslash is literal text in a composition, not an input reference.
const STORED_REFERENCE = /\$\{[^{}]*\}|(?<!\\)\{\{[A-Za-z0-9_.-]+\}\}/g;
// A short name is a lone `{name}`. One right after "$" starts an expression typed out in
// full, and one with a brace on either side is the inside of an input reference, `{{name}}`.
const DISPLAYED_REFERENCE = /(?<![${])\{([^{}\s$]+)\}(?!\})/g;
// A displayed call is a lone `{name(…)}`, read the same way.
const DISPLAYED_CALL = /(?<![${])\{([A-Za-z_][A-Za-z0-9_]*)\s*\([^{}]*\)\}(?!\})/g;
// What a stored call must look like to be shown short: toStoredText reads back only this shape.
const STORED_CALL = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(.*\)$/s;

/**
 * The stored value as a field shows it: every known reference as `{name}`. A reference
 * whose short form would sit right after a "$" or "{", or right before a "}", stays in
 * full, since toStoredText would not read that short form back as the name and the
 * field would lose the reference.
 */
export function toDisplayText(stored: string, names: VariableNames): string {
  return stored.replace(STORED_REFERENCE, (match: string, offset: number) => {
    const name = names.nameByToken.get(match) ?? shortCall(match, names);
    const before = stored[offset - 1];
    const after = stored[offset + match.length];
    if (name === undefined || before === "$" || before === "{" || after === "}") {
      return match;
    }
    return `{${name}}`;
  });
}

/**
 * What a field's text stores: every `{name}` that names a known variable as its full
 * reference. With `functions`, for an engine that runs them, a `{round(amount, 2)}`
 * calling a known function is an expression too. Left as text, it would reach viewers
 * in its braces.
 */
export function toStoredText(display: string, names: VariableNames, { functions }: { functions: boolean }): string {
  const called = functions
    ? display.replace(DISPLAYED_CALL, (match, name: string) =>
        isExpressionFunction(name) ? fullCall(match, names) : match
      )
    : display;
  return called.replace(DISPLAYED_REFERENCE, (match, name: string) => names.tokenByName.get(name) ?? match);
}

/**
 * Whether a field can take function calls. `available` converts them; the others leave
 * `{round(amount)}` as text, which a note under the field has to say.
 */
export type FunctionAvailability = "available" | "engine-update-needed" | "not-here" | "checking";

/** A known function's call opening in a field's text, with or without its `$`. */
const CALL_OPENING = /(?<!\{)\$?\{([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * Why a field's expressions would not run, in a streamer's words, or `null`. The engine
 * refuses a bad call when the workflow is saved; this says so while typing.
 */
export function expressionProblem(
  stored: string,
  display: string,
  names: VariableNames,
  availability: FunctionAvailability
): string | null {
  for (const match of display.matchAll(CALL_OPENING)) {
    const name = match[1] as string;
    if (!isExpressionFunction(name)) {
      continue;
    }
    if (availability === "engine-update-needed") {
      return `Update your engine to use functions like ${name}. For now this would be shown as plain text.`;
    }
    if (availability === "not-here") {
      return `Functions like ${name} can't be used here. This would be shown as plain text.`;
    }
    if (availability === "checking") {
      return null;
    }
    const rest = display.slice(match.index + match[0].length);
    if (!closesBeforeNextBrace(rest)) {
      return `This ${name}(…) isn't finished. Check its parentheses and the closing }.`;
    }
  }
  if (availability !== "available") {
    return null;
  }
  for (const match of display.matchAll(DISPLAYED_CALL)) {
    const name = match[1] as string;
    if (!isExpressionFunction(name)) {
      return `"${name}" isn't a function.`;
    }
  }
  const problem = functionCallProblem(stored);
  if (problem !== null) {
    return readableCallProblem(problem);
  }
  for (const match of stored.matchAll(/\$\{([^{}]*)\}/g)) {
    const inner = match[1] as string;
    if (STORED_CALL.test(inner)) {
      // A bare name is never a path into anything, so it can only be a misspelt variable.
      const unknown = expressionReferences(inner).find(
        (path) => !path.includes(".") && !names.nameByToken.has(`\${${path}}`)
      );
      if (unknown !== undefined) {
        return `"${unknown}" isn't a variable here.`;
      }
    }
  }
  return null;
}

/**
 * The first expression in a step's settings that could only go wrong once saved, or
 * `null`: a call the engine would refuse, or one left as text that viewers would see.
 * It checks stored values alone, so it can run over a whole workflow.
 */
export function storedExpressionProblem(value: unknown): string | null {
  if (typeof value === "string") {
    const problem = functionCallProblem(value);
    if (problem !== null) {
      return readableCallProblem(problem);
    }
    for (const match of value.matchAll(/(?<![${])\{([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const name = match[1] as string;
      if (isExpressionFunction(name)) {
        return `{${name}(…)} isn't a working expression. Check it's finished and that your engine is up to date.`;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = storedExpressionProblem(item);
      if (problem !== null) {
        return problem;
      }
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    return storedExpressionProblem(Object.values(value));
  }
  return null;
}

function closesBeforeNextBrace(text: string): boolean {
  const close = text.indexOf("}");
  const open = text.indexOf("{");
  return close !== -1 && (open === -1 || close < open);
}

function readableCallProblem(problem: string): string {
  const detail = problem.slice(problem.indexOf("}: ") + 3).replace(/\b1 arguments\b/, "1 argument");
  return /^(unknown function|\S+ takes at)/.test(detail) ? detail : "Check this call's parentheses, commas and quotes.";
}

function shortCall(token: string, names: VariableNames): string | undefined {
  const inner = VARIABLE_TOKEN.exec(token)?.[1];
  const name = inner === undefined ? undefined : STORED_CALL.exec(inner)?.[1];
  if (inner === undefined || name === undefined || !isExpressionFunction(name)) {
    return undefined;
  }
  return rewriteExpressionReferences(inner, (path) => names.nameByToken.get(`\${${path}}`) ?? path);
}

function fullCall(displayed: string, names: VariableNames): string {
  const inner = displayed.slice(1, -1);
  const full = rewriteExpressionReferences(inner, (path) => {
    const token = names.tokenByName.get(path);
    return token !== undefined && VARIABLE_TOKEN.test(token) ? token.slice(2, -1) : path;
  });
  return `\${${full}}`;
}

function referenceSegments(token: string): string[] {
  const input = INPUT_TOKEN.exec(token);
  if (input) {
    return [input[1]];
  }
  const variable = VARIABLE_TOKEN.exec(token);
  if (!variable) {
    throw new Error(`variable option value is not a \${…} or {{…}} reference: ${token}`);
  }
  return variable[1].split(".");
}
