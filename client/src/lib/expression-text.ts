/**
 * Reading the references out of a `${…}` expression's text. The engine owns the
 * grammar (workflow/internal/expression/compound.go); this only tells references
 * from everything else, by the same character rules, so a field can shorten and
 * lengthen them without changing anything around them.
 */

const KEYWORDS = new Set(["true", "false", "null"]);
const REFERENCE_START = /[A-Za-z_$]/;
const REFERENCE_CHAR = /[A-Za-z0-9_$.[\]-]/;
const DIGIT = /[0-9]/;

interface Visitor {
  reference(path: string): string;
  /** A name directly followed by "(". */
  call?(name: string): void;
}

function scan(expr: string, visitor: Visitor): string {
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const c = expr[i] as string;
    if (c === "'" || c === '"') {
      const close = expr.indexOf(c, i + 1);
      const end = close < 0 ? expr.length : close + 1;
      out += expr.slice(i, end);
      i = end;
    } else if (DIGIT.test(c)) {
      let j = i + 1;
      while (j < expr.length && (DIGIT.test(expr[j] as string) || expr[j] === ".")) {
        j++;
      }
      out += expr.slice(i, j);
      i = j;
    } else if (REFERENCE_START.test(c)) {
      let j = i + 1;
      while (j < expr.length && REFERENCE_CHAR.test(expr[j] as string)) {
        j++;
      }
      const word = expr.slice(i, j);
      if (expr.slice(j).trimStart().startsWith("(")) {
        visitor.call?.(word);
        out += word;
      } else if (KEYWORDS.has(word)) {
        out += word;
      } else {
        out += visitor.reference(word);
      }
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** `expr` with each reference replaced; function names, literals and punctuation stay as written. */
export function rewriteExpressionReferences(expr: string, rewrite: (path: string) => string): string {
  return scan(expr, { reference: rewrite });
}

export function expressionReferences(expr: string): string[] {
  const references: string[] = [];
  scan(expr, {
    reference: (path) => {
      references.push(path);
      return path;
    },
  });
  return references;
}

/** The functions an expression calls, outermost first as written. */
export function expressionCalls(expr: string): string[] {
  const calls: string[] = [];
  scan(expr, { reference: (path) => path, call: (name) => calls.push(name) });
  return calls;
}

/** Every `${…}` in a text as `{…}`, with each path cut to its last segment, for reading rather than editing. */
export function shortenExpressions(text: string): string {
  return text.replace(/\$\{([^{}]*)\}/g, (_match, expr: string) => `{${shortenExpression(expr)}}`);
}

export function shortenExpression(expr: string): string {
  return rewriteExpressionReferences(expr, (path) => path.split(".").pop() || path);
}
