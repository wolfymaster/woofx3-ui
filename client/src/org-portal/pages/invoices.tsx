import { api } from "@convex/_generated/api";
import type { Invoice } from "@convex/lib/payments/provider";
import { useAction } from "convex/react";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { actionErrorMessage } from "@/lib/action-error";
import { describeDiscount, formatCents, formatDay } from "../format";
import { useOrganization } from "../organization-context";

type InvoiceList =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; invoices: Invoice[] };

export default function InvoicesPage() {
  const { organization } = useOrganization();
  const listInvoices = useAction(api.billing.invoices);
  const [list, setList] = useState<InvoiceList>({ state: "loading" });
  const discount = organization.subscription?.discount ?? null;

  useEffect(() => {
    let current = true;
    setList({ state: "loading" });
    listInvoices({ accountId: organization.accountId }).then(
      (invoices) => {
        if (current) {
          setList({ state: "ready", invoices: invoices ?? [] });
        }
      },
      (error: unknown) => {
        if (current) {
          setList({ state: "failed", message: actionErrorMessage(error) });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [listInvoices, organization.accountId]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Active discount</CardTitle>
        </CardHeader>
        <CardContent data-testid="text-active-discount">
          {discount === null ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <p>
              {describeDiscount(discount)}
              {discount.code ? <span className="text-muted-foreground"> (code {discount.code})</span> : null}
              {discount.endsAt ? (
                <span className="text-muted-foreground">, until {formatDay(discount.endsAt)}</span>
              ) : null}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Invoices open on Stripe. woofx3 keeps no copy of them.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.state === "loading" ? <p className="text-sm text-muted-foreground">Loading invoices...</p> : null}
          {list.state === "failed" ? <p className="text-sm text-destructive">{list.message}</p> : null}
          {list.state === "ready" && list.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : null}
          {list.state === "ready" && list.invoices.length > 0 ? (
            <Table>
              <TableBody>
                {list.invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{formatDay(invoice.periodStart)}</TableCell>
                    <TableCell>{formatCents(invoice.amountCents)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {invoice.hostedUrl ? (
                        <a
                          href={invoice.hostedUrl}
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
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
