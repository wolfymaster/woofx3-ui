import type { PublicDatabaseColumn } from "@shared/user-pages";
import type { WidgetOf } from "./types";
import { WidgetLabel } from "./widget-label";

type Cell = string | number | boolean | null;

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

/** A cell as text: a select's option label, a date in the visitor's style, a yes or no. */
export function cellLabel(column: PublicDatabaseColumn, value: Cell): string {
  if (value === null) {
    return "";
  }
  switch (column.type) {
    case "boolean":
      return value === true ? "Yes" : "No";
    case "date": {
      const at = Date.parse(`${String(value)}T00:00:00Z`);
      return Number.isNaN(at) ? String(value) : DATE_FORMAT.format(at);
    }
    case "select":
      return column.options?.find((option) => option.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

function CellView({ column, value }: { column: PublicDatabaseColumn; value: Cell }) {
  if (column.type === "url" && typeof value === "string" && /^https?:\/\//.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
        {column.label}
      </a>
    );
  }
  return <>{cellLabel(column, value)}</>;
}

/** A table on wide screens, one stacked card per row on narrow ones. */
export function DatabaseWidget({ widget }: { widget: WidgetOf<"database"> }) {
  const { columns, rows } = widget;
  return (
    <div>
      {widget.label !== null && <WidgetLabel>{widget.label}</WidgetLabel>}
      {rows.length === 0 || columns.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <>
          <table className="mt-2 hidden w-full text-left text-sm sm:table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} className="pb-2 pr-4 font-semibold">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                // Rows carry no id to a visitor; their order is the widget's own and stable per render.
                // biome-ignore lint/suspicious/noArrayIndexKey: public rows have no identity to key by
                <tr key={index} className="border-t border-current/10">
                  {columns.map((column, at) => (
                    <td key={column.id} className="py-2 pr-4 align-top">
                      <CellView column={column} value={row[at] ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-2 space-y-3 sm:hidden">
            {rows.map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: public rows have no identity to key by
              <li key={index} className="space-y-1 rounded-md border border-current/10 p-3 text-sm">
                {columns.map((column, at) =>
                  row[at] === null ? null : (
                    <div key={column.id}>
                      <span className="text-muted">{column.label}: </span>
                      <CellView column={column} value={row[at] ?? null} />
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
