/**
 * The rows of a `list` config field, as the list editor shows and edits them.
 *
 * A list's value is an array of objects keyed by its item fields' ids. A value
 * that is a string is a field declared as text before it became a list, holding
 * comma-separated entries (a counter's goals were `"100, 250"`): each entry
 * reads as a row with it in the first item field. Reading it this way is what
 * keeps the first edit from dropping those entries, because saving writes the
 * rows back as an array.
 */
export type ListRow = Record<string, unknown>;

export function listRows(value: unknown, firstFieldId: string | undefined): ListRow[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is ListRow => row !== null && typeof row === "object" && !Array.isArray(row));
  }
  if (typeof value === "string" && firstFieldId !== undefined) {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => ({ [firstFieldId]: part }));
  }
  return [];
}

export function withRowChanged(rows: ListRow[], index: number, fieldId: string, fieldValue: unknown): ListRow[] {
  return rows.map((row, i) => (i === index ? { ...row, [fieldId]: fieldValue } : row));
}

export function withRowRemoved(rows: ListRow[], index: number): ListRow[] {
  return rows.filter((_, i) => i !== index);
}
