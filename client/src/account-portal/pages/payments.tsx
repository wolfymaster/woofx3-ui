import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Invoice } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { PaymentsTable } from "@/billing/payments-table";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { actionErrorMessage } from "@/lib/action-error";
import { SPONSOR_START_PATH } from "@/sponsorship/sponsorship-text";
import { billingErrorCode } from "../billing-view";
import { useOptionalOrganization } from "../organization-context";
import { filterRows, hasBothKinds, type PaymentFilter, paymentRows } from "../payment-rows";
import { useSponsorships } from "../use-sponsorships";

type InvoiceList =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; invoices: Invoice[] };

const FILTER_LABELS: Record<PaymentFilter, string> = { all: "All", plan: "Plan", sponsorship: "Sponsorship" };
const LINK_COLUMNS: Record<PaymentFilter, string> = { all: "Document", plan: "Invoice", sponsorship: "Receipt" };

/** The organization's invoices when the viewer manages its billing; nobody else's. */
function useInvoices(accountId: Id<"accounts"> | null): InvoiceList {
  const listInvoices = useAction(api.billingCommands.invoices);
  const [list, setList] = useState<InvoiceList>(
    accountId === null ? { state: "ready", invoices: [] } : { state: "loading" }
  );
  useEffect(() => {
    if (accountId === null) {
      setList({ state: "ready", invoices: [] });
      return;
    }
    let current = true;
    setList({ state: "loading" });
    listInvoices({ accountId: accountId }).then(
      (invoices) => {
        if (current) {
          setList({ state: "ready", invoices: invoices ?? [] });
        }
      },
      (error: unknown) => {
        if (!current) {
          return;
        }
        // An organization with no billing yet, such as one with only self-hosted engines, has no invoices to list.
        setList(
          billingErrorCode(error) === "subscription_not_found"
            ? { state: "ready", invoices: [] }
            : { state: "failed", message: actionErrorMessage(error) }
        );
      }
    );
    return () => {
      current = false;
    };
  }, [listInvoices, accountId]);
  return list;
}

export default function PaymentsPage() {
  const organization = useOptionalOrganization()?.organization ?? null;
  const invoices = useInvoices(organization?.can.manageBilling ? organization.accountId : null);
  const { list: sponsorships } = useSponsorships();
  const [filter, setFilter] = useState<PaymentFilter>("all");

  const loading = invoices.state === "loading" || sponsorships.state === "loading";
  const rows = paymentRows(
    invoices.state === "ready" ? invoices.invoices : [],
    sponsorships.state === "ready" ? sponsorships.sponsorships : []
  );
  // One failed lookup is one message, and an empty list is never shown for a lookup that did not answer.
  const failure =
    invoices.state === "failed" ? invoices.message : sponsorships.state === "failed" ? sponsorships.message : null;
  // Rows show as each source answers, so a slow lookup holds back only its own rows. An empty list waits for every
  // source: until then it would say "nothing" about a lookup that has not answered.
  const showTable = rows.length > 0 || (!loading && failure === null);
  const both = hasBothKinds(rows);
  const shown = filterRows(rows, both ? filter : "all");
  const kind: PaymentFilter = both ? filter : (rows[0]?.kind ?? "all");

  return (
    <>
      <PageHeader title="Payments" description="What you have paid." />
      <Card data-testid="card-payments">
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>
            Invoices and receipts open on the payment provider. woofx3 keeps no copy of them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {both ? (
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value) => setFilter(value === "" ? "all" : (value as PaymentFilter))}
              aria-label="Filter payments"
              data-testid="filter-payments"
            >
              {(Object.keys(FILTER_LABELS) as PaymentFilter[]).map((option) => (
                <ToggleGroupItem key={option} value={option} data-testid={`filter-payments-${option}`}>
                  {FILTER_LABELS[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          {failure === null ? null : (
            <p className="text-sm text-destructive" data-testid="text-payments-failed">
              {failure}
            </p>
          )}
          {loading ? <p className="text-sm text-muted-foreground">Loading payments...</p> : null}
          {showTable ? <PaymentsTable rows={shown} empty="No payments yet." linkColumn={LINK_COLUMNS[kind]} /> : null}
          {!loading && failure === null && rows.length === 0 ? (
            <Button asChild variant="outline">
              <Link href={SPONSOR_START_PATH} data-testid="link-become-sponsor">
                Become a sponsor
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
