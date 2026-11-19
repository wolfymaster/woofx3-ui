import type { Invoice, Sponsorship } from "@convex/lib/billingClient";
import type { PaymentRow } from "@/billing/payments-table";
import { paymentDescription } from "@/sponsorship/sponsorship-text";

/** Plan invoices as payment rows, newest first. */
export function invoiceRows(invoices: Invoice[]): PaymentRow[] {
  return invoices
    .map(
      (invoice): PaymentRow => ({
        id: `invoice:${invoice.id}`,
        dateMs: invoice.periodStart,
        description: "Plan",
        amountCents: invoice.amountCents,
        status: invoice.status,
        url: invoice.hostedUrl,
      })
    )
    .sort((a, b) => b.dateMs - a.dateMs);
}

/** Sponsor payments as payment rows, newest first. */
export function sponsorshipRows(sponsorships: Sponsorship[]): PaymentRow[] {
  return sponsorships
    .flatMap((sponsorship) =>
      sponsorship.payments.map(
        (payment): PaymentRow => ({
          id: `sponsorship:${sponsorship.id}:${payment.id}`,
          dateMs: payment.paidAt,
          description: paymentDescription(sponsorship),
          amountCents: payment.amountCents,
          status: payment.status,
          url: payment.receiptUrl,
        })
      )
    )
    .sort((a, b) => b.dateMs - a.dateMs);
}
