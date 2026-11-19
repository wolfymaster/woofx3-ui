import { PaymentsTable } from "@/billing/payments-table";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sponsorshipRows } from "../payment-rows";
import { SponsorshipSection } from "../sponsorship-section";
import { useSponsorships } from "../use-sponsorships";

export default function SponsorshipPage() {
  const { list } = useSponsorships();
  const rows = list.state === "ready" ? sponsorshipRows(list.sponsorships) : [];
  return (
    <>
      <PageHeader title="Sponsorship" description="Support woofx3 and manage what you give." />
      <SponsorshipSection />
      {rows.length > 0 ? (
        <Card className="mt-6" data-testid="card-sponsorship-payments">
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>Receipts open on the payment provider.</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentsTable rows={rows} linkColumn="Receipt" />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
