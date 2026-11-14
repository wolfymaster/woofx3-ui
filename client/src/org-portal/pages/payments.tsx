import { api } from "@convex/_generated/api";
import type { Invoice } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { PaymentsTable } from "@/billing/payments-table";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { actionErrorMessage } from "@/lib/action-error";
import { useOrganization } from "../organization-context";

type InvoiceList =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; invoices: Invoice[] };

export default function PaymentsPage() {
  const { organization } = useOrganization();
  const listInvoices = useAction(api.billingCommands.invoices);
  const [list, setList] = useState<InvoiceList>({ state: "loading" });

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
    <>
      <PageHeader title="Payments" description="What this organization has been charged." />
      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Invoices open on Stripe. woofx3 keeps no copy of them.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.state === "loading" ? <p className="text-sm text-muted-foreground">Loading payments...</p> : null}
          {list.state === "failed" ? <p className="text-sm text-destructive">{list.message}</p> : null}
          {list.state === "ready" ? (
            <PaymentsTable
              rows={list.invoices.map((invoice) => ({
                id: invoice.id,
                dateMs: invoice.periodStart,
                amountCents: invoice.amountCents,
                status: invoice.status,
                url: invoice.hostedUrl,
              }))}
              empty="No payments yet."
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
