import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSeats } from "../format";
import { useOrganization } from "../organization-context";
import { portalPage } from "../portal-pages";
import { RenameDialog } from "../rename-dialog";
import { planLabel, stateLabel, subscriptionNotice } from "../subscription-text";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export default function OverviewPage() {
  const { organization } = useOrganization();
  const rename = useMutation(api.organizations.rename);
  const { subscription, seats, engines, can } = organization;
  const hosted = engines.filter((engine) => engine.hosting === "managed").length;
  const selfHosted = engines.length - hosted;
  const engineSummary = [hosted > 0 ? `${hosted} hosted` : null, selfHosted > 0 ? `${selfHosted} self-hosted` : null]
    .filter((part) => part !== null)
    .join(", ");
  const notice = subscription === null ? null : subscriptionNotice(subscription);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle data-testid="text-organization-name">{organization.name}</CardTitle>
        {can.renameOrganization ? (
          <RenameDialog
            title="Rename organization"
            current={organization.name}
            onRename={(name) => rename({ accountId: organization.accountId, name })}
            testId="button-rename-organization"
          />
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <Fact label="Your role" value={organization.role} />
          <Fact label="Engines" value={engineSummary || "None yet"} />
          {subscription ? <Fact label="Plan" value={planLabel(subscription)} /> : null}
          {subscription ? <Fact label="State" value={stateLabel(subscription)} /> : null}
          {seats ? <Fact label="Members" value={formatSeats(seats)} /> : null}
        </div>
        {notice ? (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
            <div className="space-y-3">
              <p data-testid="text-overview-notice">{notice}</p>
              {can.manageBilling ? (
                <Button size="sm" asChild>
                  <Link href={portalPage("billing").path}>Choose a plan</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
