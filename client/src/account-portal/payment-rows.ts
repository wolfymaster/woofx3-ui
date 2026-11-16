import type { Invoice, Sponsorship } from "@convex/lib/billingClient";
import type { PaymentRow } from "@/billing/payments-table";
import { paymentDescription } from "@/sponsorship/sponsorship-text";

export type PaymentKind = "plan" | "sponsorship";
export type PaymentFilter = "all" | PaymentKind;

export interface KindedPaymentRow extends PaymentRow {
  kind: PaymentKind;
}

/** Plan invoices and sponsor payments as one history, newest first. */
export function paymentRows(invoices: Invoice[], sponsorships: Sponsorship[]): KindedPaymentRow[] {
  const plan = invoices.map(
    (invoice): KindedPaymentRow => ({
      kind: "plan",
      id: `invoice:${invoice.id}`,
      dateMs: invoice.periodStart,
      description: "Plan",
      amountCents: invoice.amountCents,
      status: invoice.status,
      url: invoice.hostedUrl,
    })
  );
  const sponsored = sponsorships.flatMap((sponsorship) =>
    sponsorship.payments.map(
      (payment): KindedPaymentRow => ({
        kind: "sponsorship",
        id: `sponsorship:${sponsorship.id}:${payment.id}`,
        dateMs: payment.paidAt,
        description: paymentDescription(sponsorship),
        amountCents: payment.amountCents,
        status: payment.status,
        url: payment.receiptUrl,
      })
    )
  );
  return [...plan, ...sponsored].sort((a, b) => b.dateMs - a.dateMs);
}

/** The filter shows only when there is something on each side to choose between. */
export function hasBothKinds(rows: KindedPaymentRow[]): boolean {
  return rows.some((row) => row.kind === "plan") && rows.some((row) => row.kind === "sponsorship");
}

export function filterRows(rows: KindedPaymentRow[], filter: PaymentFilter): KindedPaymentRow[] {
  return filter === "all" ? rows : rows.filter((row) => row.kind === filter);
}
