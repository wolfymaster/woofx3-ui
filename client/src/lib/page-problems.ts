import type { PageProblem } from "@shared/user-pages";

/**
 * Problems found in a page, looked up by where they are. Paths are the ones
 * `checkPageContent` and the server's refusals use
 * (`sections[0].widgets[2].config.links[1].url`), so a field shows the
 * messages at its own path and a card counts the ones anywhere inside it.
 */
export class ProblemIndex {
  private readonly byPath = new Map<string, string[]>();

  constructor(private readonly problems: readonly PageProblem[]) {
    for (const problem of problems) {
      const messages = this.byPath.get(problem.path);
      if (messages) {
        messages.push(problem.message);
      } else {
        this.byPath.set(problem.path, [problem.message]);
      }
    }
  }

  static readonly empty = new ProblemIndex([]);

  get size(): number {
    return this.problems.length;
  }

  /** The messages reported at exactly `path`. */
  at(path: string): readonly string[] {
    return this.byPath.get(path) ?? [];
  }

  /** How many problems sit at `path` or anywhere below it. */
  countUnder(path: string): number {
    return this.problems.filter((problem) => isWithinPath(problem.path, path)).length;
  }
}

/** Whether `path` is `parent` or a field or item below it; `sections[1]` does not contain `sections[10]`. */
export function isWithinPath(path: string, parent: string): boolean {
  if (parent === "") {
    return true;
  }
  if (path === parent) {
    return true;
  }
  return path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`);
}

/** The path of a field below `parent`, built the way the shared checks build theirs. */
export function fieldPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}.${name}`;
}

export function itemPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}
