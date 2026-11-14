import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

/** A payment history, shared by an organization's invoices and a sponsorship's payments. */
export function PaymentsTable({ rows, empty = "Nothing here yet.", linkColumn = "Invoice" }: PaymentsTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  const hasDescription = rows.some((row) => row.description !== undefined);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          {hasDescription ? <TableHead>Description</TableHead> : null}
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">{linkColumn}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{formatDay(row.dateMs)}</TableCell>
            {hasDescription ? <TableCell>{row.description}</TableCell> : null}
            <TableCell>{formatCents(row.amountCents)}</TableCell>
            <TableCell>
              <Badge variant="outline" className="capitalize">
                {row.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
                >
                  View
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
