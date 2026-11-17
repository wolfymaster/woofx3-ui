import { parseHttpsUrl } from "@convex/lib/httpsUrl";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCents, formatDay } from "./format";

export interface PaymentRow {
  id: string;
  dateMs: number;
  /** What the payment was for; shown only when a subject supplies it (a sponsorship does, a plan invoice need not). */
  description?: string;
  amountCents: number;
  status: string;
  /** The provider's hosted document; null when there is none to open. */
  url: string | null;
}

interface PaymentsTableProps {
  rows: PaymentRow[];
  empty?: string;
  /** The heading of the link column — "Invoice" for a plan, "Receipt" for a sponsorship. */
  linkColumn?: string;
}

const COLUMN = {
  date: "sm:w-28 sm:shrink-0",
  description: "sm:flex-1 sm:min-w-0",
  amount: "sm:w-24 sm:shrink-0",
  status: "sm:w-28 sm:shrink-0",
  link: "sm:w-24 sm:shrink-0 sm:text-right",
} as const;

/**
 * A payment history, shared by an organization's invoices and a sponsorship's payments. Each payment is a row of
 * columns from `sm` up and a stacked block below it, so nothing scrolls sideways on a phone. The link column exists
 * only while some payment has something to open.
 */
export function PaymentsTable({ rows, empty = "Nothing here yet.", linkColumn = "Invoice" }: PaymentsTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  const hasDescription = rows.some((row) => row.description !== undefined);
  const hasLink = rows.some((row) => row.url !== null);
  return (
    <div>
      <div
        className="hidden sm:flex sm:items-center sm:gap-4 border-b pb-2 text-xs uppercase tracking-wide text-muted-foreground"
        aria-hidden="true"
      >
        <span className={COLUMN.date}>Date</span>
        <span className={hasDescription ? COLUMN.description : "sm:flex-1"}>{hasDescription ? "Description" : ""}</span>
        <span className={COLUMN.amount}>Amount</span>
        <span className={COLUMN.status}>Status</span>
        {hasLink ? <span className={COLUMN.link}>{linkColumn}</span> : null}
      </div>
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
            <span className={COLUMN.date}>{formatDay(row.dateMs)}</span>
            {hasDescription ? (
              <span className={COLUMN.description}>{row.description}</span>
            ) : (
              <span className="hidden sm:block sm:flex-1" />
            )}
            <span className={`font-medium ${COLUMN.amount}`}>{formatCents(row.amountCents)}</span>
            <span className={COLUMN.status}>
              <Badge variant="outline" className="capitalize">
                {row.status}
              </Badge>
            </span>
            {hasLink ? (
              <span className={COLUMN.link}>
                {row.url && parseHttpsUrl(row.url).ok ? (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    View
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
