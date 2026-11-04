import {
  DATABASE_COLUMN_TYPES,
  DATABASE_COLUMNS_SETTING,
  DATABASE_LIMITS,
  type DatabaseColumn,
  type DatabaseColumnOption,
  type DatabaseColumnType,
  type DatabaseValue,
} from "@woofx3/api/databases";
import { type PageProblem, ProblemReport } from "../user-pages/problems";

// The dashboard's copy of the column rules, so the editor can point at a
// problem before a save. The engine checks the same rules on every write and
// is the authority: these must match db/app/services/database_columns.go.

const COLUMN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ALL_DIGITS = /^[0-9]+$/;
/** Room left under the 64-character id limit for a "_<n>" suffix. */
const GENERATED_ID_BASE_LENGTH = 48;

export const COLUMN_TYPE_LABELS: Readonly<Record<DatabaseColumnType, string>> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / no",
  date: "Date",
  url: "Link",
  select: "Choice",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isColumnType(value: unknown): value is DatabaseColumnType {
  return typeof value === "string" && (DATABASE_COLUMN_TYPES as readonly string[]).includes(value);
}

function parseOption(raw: unknown): DatabaseColumnOption | null {
  const option = asRecord(raw);
  return option && typeof option.value === "string" && typeof option.label === "string"
    ? { value: option.value, label: option.label }
    : null;
}

function parseColumn(raw: unknown): DatabaseColumn | null {
  const column = asRecord(raw);
  if (!column || typeof column.id !== "string" || typeof column.label !== "string" || !isColumnType(column.type)) {
    return null;
  }
  const parsed: DatabaseColumn = {
    id: column.id,
    label: column.label,
    type: column.type,
    public: column.public === true,
  };
  if (column.type === "select") {
    parsed.options = Array.isArray(column.options) ? column.options.flatMap((o) => parseOption(o) ?? []) : [];
  }
  return parsed;
}

/** The column definitions of a database instance's settings; entries that are not one are dropped. */
export function parseDatabaseColumns(settings: Record<string, unknown>): DatabaseColumn[] {
  const raw = settings[DATABASE_COLUMNS_SETTING];
  return Array.isArray(raw) ? raw.flatMap((column) => parseColumn(column) ?? []) : [];
}

/** A fresh id for a new column, from its label, unique among `taken`. */
export function columnIdFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, GENERATED_ID_BASE_LENGTH) || "column";
  const start = ALL_DIGITS.test(base) ? `c_${base}` : base;
  let id = start;
  for (let n = 2; taken.has(id); n++) {
    id = `${start}_${n}`;
  }
  return id;
}

function checkLabel(label: string, name: string, report: ProblemReport): void {
  if (label.trim() === "") {
    report.add(`${name} is required`);
  }
  report.text(label, name, DATABASE_LIMITS.label);
  if (label.includes("\0")) {
    report.add(`${name} can't hold a NUL character`);
  }
}

function checkColumn(column: DatabaseColumn, report: ProblemReport): void {
  if (!COLUMN_ID.test(column.id) || ALL_DIGITS.test(column.id)) {
    report.field("id").add("Column id must be 1 to 64 letters, digits, - or _, and not only digits");
  }
  checkLabel(column.label, "Name", report.field("label"));
  if (column.type !== "select") {
    return;
  }
  const options = column.options ?? [];
  if (options.length === 0) {
    report.field("options").add("A choice column needs at least one option");
  }
  report.field("options").count(options.length, "options", DATABASE_LIMITS.selectOptions);
  const seen = new Set<string>();
  options.forEach((option, index) => {
    const at = report.field("options").item(index);
    if (!COLUMN_ID.test(option.value)) {
      at.field("value").add("Option value must be 1 to 64 letters, digits, - or _");
    }
    if (seen.has(option.value)) {
      at.field("value").add("Two options have this value");
    }
    seen.add(option.value);
    checkLabel(option.label, "Option", at.field("label"));
  });
}

/** Problems with a set of column definitions, by path under `report`. */
export function checkDatabaseColumns(columns: readonly DatabaseColumn[], report: ProblemReport): void {
  report.count(columns.length, "columns", DATABASE_LIMITS.columns);
  const seen = new Set<string>();
  columns.forEach((column, index) => {
    checkColumn(column, report.item(index));
    if (seen.has(column.id)) {
      report.item(index).field("id").add("Two columns have this id");
    }
    seen.add(column.id);
  });
}

export function databaseColumnProblems(columns: readonly DatabaseColumn[], path: string): PageProblem[] {
  const problems: PageProblem[] = [];
  checkDatabaseColumns(columns, ProblemReport.root(problems).field(path));
  return problems;
}

/** A cell typed into the dashboard, as the engine stores it: `null` for an empty cell. */
export type CellParse = { ok: true; value: DatabaseValue | null } | { ok: false; error: string };

/**
 * Reads what was typed for a cell. The engine checks it again; this only
 * says what is wrong before asking.
 */
export function parseCell(column: DatabaseColumn, text: string): CellParse {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  switch (column.type) {
    case "number": {
      const number = Number(trimmed);
      return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, error: "Enter a number" };
    }
    case "boolean":
      if (trimmed === "true" || trimmed === "false") {
        return { ok: true, value: trimmed === "true" };
      }
      return { ok: false, error: "Choose yes or no" };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))
        ? { ok: true, value: trimmed }
        : { ok: false, error: "Enter a date" };
    case "url": {
      let url: URL | null = null;
      try {
        url = new URL(trimmed);
      } catch {
        url = null;
      }
      return url !== null &&
        (url.protocol === "http:" || url.protocol === "https:") &&
        trimmed.length <= DATABASE_LIMITS.url
        ? { ok: true, value: trimmed }
        : { ok: false, error: "Enter a link starting with http:// or https://" };
    }
    case "select":
      return (column.options ?? []).some((option) => option.value === trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, error: "Pick one of the options" };
    case "text":
      return text.length <= DATABASE_LIMITS.text
        ? { ok: true, value: text }
        : { ok: false, error: `Keep it to ${DATABASE_LIMITS.text} characters` };
  }
}

export function cellText(value: DatabaseValue | undefined): string {
  return value === undefined ? "" : String(value);
}

/** The "Games I've played" template's columns, all public. */
export const GAMES_PLAYED_COLUMNS: readonly DatabaseColumn[] = [
  { id: "game", label: "Game", type: "text", public: true },
  { id: "first_played", label: "First played", type: "date", public: true },
  { id: "vod", label: "VOD", type: "url", public: true },
  { id: "playlist", label: "Playlist", type: "url", public: true },
];
