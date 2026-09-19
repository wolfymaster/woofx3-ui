import type { VariableOption } from "@/lib/workflow-variables";

/**
 * How variable references read in a text field. The engine needs the full
 * `${trigger.data.user.firstName}`, and that is what gets stored, but a field shows it
 * as `{firstName}`: the last segment of the path, lengthened from the end only as far
 * as it takes to tell two variables apart (`{increment.next}` beside
 * `{increment-2.next}`).
 *
 * Only a reference to a variable in `options` is shortened. Anything else inside
 * `${…}` (a compound expression, or a reference to a step that no longer runs first)
 * stays as typed, so a broken reference is visible rather than disguised.
 */
export interface VariableNames {
  /** Stored token (`${trigger.data.firstName}`) to its short name (`firstName`). */
  nameByToken: ReadonlyMap<string, string>;
  /** Short name to the stored token. */
  tokenByName: ReadonlyMap<string, string>;
}

export function variableNames(options: readonly VariableOption[]): VariableNames {
  const tokens = Array.from(new Set(options.map((option) => option.value)));
  const segmentsByToken = new Map(tokens.map((token) => [token, referencePath(token).split(".")]));
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

const STORED_REFERENCE = /\$\{([^{}]*)\}/g;
// A "{" right after "$" is the start of an expression the user typed out in full, not a short name.
const DISPLAYED_REFERENCE = /(?<!\$)\{([^{}\s$]+)\}/g;

/** The stored value as a field shows it: every known `${…}` reference as `{name}`. */
export function toDisplayText(stored: string, names: VariableNames): string {
  return stored.replace(STORED_REFERENCE, (match) => {
    const name = names.nameByToken.get(match);
    return name === undefined ? match : `{${name}}`;
  });
}

/** What a field's text stores: every `{name}` that names a known variable as its full reference. */
export function toStoredText(display: string, names: VariableNames): string {
  return display.replace(DISPLAYED_REFERENCE, (match, name: string) => names.tokenByName.get(name) ?? match);
}

function referencePath(token: string): string {
  if (!token.startsWith("${") || !token.endsWith("}")) {
    throw new Error(`variable option value is not a \${…} reference: ${token}`);
  }
  return token.slice(2, -1);
}
