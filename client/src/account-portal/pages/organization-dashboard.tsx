import type { MyOrganization } from "@convex/organizations";
import { CalendarClock, CreditCard, Server, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { formatDay, formatPrice, formatSeats, planName } from "@/billing/format";
import { PaymentsTable } from "@/billing/payments-table";
import { StatusBanner } from "@/billing/status-banner";
import { usePlanPrices } from "@/billing/use-plan-prices";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { invoiceRows } from "../payment-rows";
import { PLANS_PATH, portalPage } from "../portal-pages";
import { stateLabel, subscriptionNotice } from "../subscription-text";
import { useInvoices } from "../use-invoices";
import { EngineList } from "./engine-list";

const RECENT_PAYMENTS = 5;

function Stat({
  icon,
  label,
  value,
  detail,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function runningEngines(engines: MyOrganization["engines"]): number {
  return engines.filter((engine) => engine.hosting === "managed" && engine.status === "registered").length;
}

/** What the organization's billing owner sees at a glance: plan, next bill, engines, seats, and the last payments. */
function BillingStats({ organization }: { organization: MyOrganization }) {
  const { prices, names } = usePlanPrices();
  const { subscription, seats, engines } = organization;
  const plan = subscription?.plan ?? null;
  const price = plan !== null && subscription?.interval ? formatPrice(prices, plan, subscription.interval) : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="section-dashboard-stats">
      {subscription ? (
        <Stat
          testId="stat-plan"
          icon={<CreditCard className="h-4 w-4" />}
          label="Plan"
          value={plan === null ? "No plan" : planName(names, plan)}
          detail={[stateLabel(subscription), price].filter(Boolean).join(" · ")}
        />
      ) : null}
      {subscription ? (
        <Stat
          testId="stat-next-billing"
          icon={<CalendarClock className="h-4 w-4" />}
          label={subscription.state === "trialing" ? "Trial ends" : "Next billing"}
          value={subscription.nextBillingAt === null ? "None scheduled" : formatDay(subscription.nextBillingAt)}
        />
      ) : null}
      <Stat
        testId="stat-engines"
        icon={<Server className="h-4 w-4" />}
        label="Engines"
        value={String(engines.length)}
        detail={`${runningEngines(engines)} running`}
      />
      {seats ? (
        <Stat testId="stat-seats" icon={<Users className="h-4 w-4" />} label="Seats" value={formatSeats(seats)} />
      ) : null}
    </div>
  );
}

function RecentPayments({ organization }: { organization: MyOrganization }) {
  const invoices = useInvoices(organization.accountId);
  const rows = invoices.state === "ready" ? invoiceRows(invoices.invoices).slice(0, RECENT_PAYMENTS) : [];
  return (
    <Card data-testid="card-recent-payments">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Recent payments</CardTitle>
          <CardDescription>The last {RECENT_PAYMENTS} invoices.</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={portalPage("payments").path}>View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {invoices.state === "loading" ? <p className="text-sm text-muted-foreground">Loading payments...</p> : null}
        {invoices.state === "failed" ? <p className="text-sm text-destructive">{invoices.message}</p> : null}
        {invoices.state === "ready" ? (
          <PaymentsTable rows={rows} empty="No payments yet." linkColumn="Invoice" />
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The organization's overview: how it stands (plan, billing, seats), its engines, and what it last paid. */
export function OrganizationDashboard({ organization }: { organization: MyOrganization }) {
  const notice = organization.subscription === null ? null : subscriptionNotice(organization.subscription);
  return (
    <div className="space-y-8" data-testid="section-organization-dashboard">
      {notice ? (
        <StatusBanner tone="warning">
          {notice}{" "}
          <Link href={PLANS_PATH} className="underline underline-offset-2">
            Manage plan
          </Link>
        </StatusBanner>
      ) : null}
      <BillingStats organization={organization} />
      <EngineList />
      {organization.can.manageBilling ? <RecentPayments organization={organization} /> : null}
    </div>
  );
}
