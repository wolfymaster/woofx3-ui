/**
 * What validating a page found wrong. Every problem names where it is, as a
 * path into the content (`sections[0].widgets[2].config.links[1].url`), so an
 * editor can point at the field and Convex can refuse the save with the same
 * list.
 */
export type PageProblem = {
  path: string;
  message: string;
};

export type PageCheck<Value> = { ok: true; value: Value } | { ok: false; problems: PageProblem[] };

export function checked<Value>(value: Value, problems: PageProblem[]): PageCheck<Value> {
  return problems.length === 0 ? { ok: true, value } : { ok: false, problems };
}

/** Collects problems under one path, so a nested check reports `${path}.field` without knowing where it sits. */
export class ProblemReport {
  constructor(
    private readonly problems: PageProblem[],
    private readonly path: string
  ) {}

  static root(problems: PageProblem[]): ProblemReport {
    return new ProblemReport(problems, "");
  }

  field(name: string): ProblemReport {
    return new ProblemReport(this.problems, this.path === "" ? name : `${this.path}.${name}`);
  }

  item(index: number): ProblemReport {
    return new ProblemReport(this.problems, `${this.path}[${index}]`);
  }

  add(message: string): void {
    this.problems.push({ path: this.path, message });
  }

  /** Reports `label` over `max` characters; empty is fine unless `required`. */
  text(value: string, label: string, max: number, required = false): void {
    if (required && value.trim() === "") {
      this.add(`${label} is required`);
    }
    if (value.length > max) {
      this.add(`${label} is ${value.length} characters; the most is ${max}`);
    }
  }

  count(length: number, label: string, max: number): void {
    if (length > max) {
      this.add(`${length} ${label}; the most is ${max}`);
    }
  }
}
