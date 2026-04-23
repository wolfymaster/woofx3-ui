// Mirrors the monorepo helper at
// woofx3/shared/common/typescript/cloudevents/slug.ts. Duplicated here
// because the UI worktree cannot reliably resolve the shared-common path
// via the `@woofx3/*` vite aliases; the generated trigger subject must
// still agree with the engine's slugging rule.

/**
 * Normalize a chat command name into a NATS subject segment.
 * Rule: strip leading "!" if present, lowercase. Reject NATS-reserved
 * characters (`.`, `*`, `>`, whitespace) — the command-create UI validates
 * this, but this fail-fast guard catches any path that bypasses validation.
 */
export function commandNameToSubjectSegment(name: string): string {
  const stripped = name.startsWith("!") ? name.slice(1) : name;
  if (stripped.length === 0) {
    throw new Error(`invalid command name: empty after stripping "!"`);
  }
  if (/[.*>\s]/.test(stripped)) {
    throw new Error(
      `invalid command name ${JSON.stringify(name)}: NATS subject segments may not contain "." "*" ">" or whitespace`,
    );
  }
  return stripped.toLowerCase();
}
