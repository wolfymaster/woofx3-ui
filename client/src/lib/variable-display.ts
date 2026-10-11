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

/**
 * The stored value as a field shows it: every known reference as `{name}`. A reference
 * whose short form would sit right after a "$" or "{", or right before a "}", stays in
 * full, since toStoredText would not read that short form back as the name and the
 * field would lose the reference.
 */
export function toDisplayText(stored: string, names: VariableNames): string {
  return stored.replace(STORED_REFERENCE, (match: string, offset: number) => {
    const name = names.nameByToken.get(match);
    const before = stored[offset - 1];
    const after = stored[offset + match.length];
    if (name === undefined || before === "$" || before === "{" || after === "}") {
      return match;
    }
    return `{${name}}`;
  });
}

/** What a field's text stores: every `{name}` that names a known variable as its full reference. */
export function toStoredText(display: string, names: VariableNames): string {
  return display.replace(DISPLAYED_REFERENCE, (match, name: string) => names.tokenByName.get(name) ?? match);
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
