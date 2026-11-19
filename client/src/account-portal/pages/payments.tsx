import { PaymentsTable } from "@/billing/payments-table";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrganization } from "../organization-context";
import { invoiceRows } from "../payment-rows";
import { useInvoices } from "../use-invoices";

/** The organization's plan invoices. */
export default function PaymentsPage() {
  const { organization } = useOrganization();
  const invoices = useInvoices(organization.accountId);

  return (
    <>
      <PageHeader title="Payments" description={`What ${organization.name} has paid.`} />
      <Card data-testid="card-payments">
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Invoices open on the payment provider. woofx3 keeps no copy of them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoices.state === "failed" ? (
            <p className="text-sm text-destructive" data-testid="text-payments-failed">
              {invoices.message}
            </p>
          ) : null}
          {invoices.state === "loading" ? <p className="text-sm text-muted-foreground">Loading payments...</p> : null}
          {invoices.state === "ready" ? (
            <PaymentsTable rows={invoiceRows(invoices.invoices)} empty="No payments yet." linkColumn="Invoice" />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
