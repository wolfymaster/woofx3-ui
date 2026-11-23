import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization, OrgEngine } from "@convex/organizations";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { $currentInstanceId } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { engineHealth, TONE_CLASS } from "../engine-health";
import { formatAgo } from "../format-ago";
import { NewEngineDialog } from "../new-engine-dialog";
import { useOptionalOrganization, useOptionalPortalScope } from "../organization-context";
import { organizationLabels } from "../organization-labels";
import { enginePath } from "../portal-pages";
import { useEngineUpgrade } from "../use-engine-upgrade";

/** What release a hosted engine runs, and a badge when a newer one is on offer. */
export function EngineVersion({ engine, enabled }: { engine: OrgEngine; enabled: boolean }) {
  const info = useEngineUpgrade(
    engine.instanceId,
    enabled && engine.hosting === "managed" && engine.status === "registered"
  );
  return (
    <>
      {info?.current ? <span data-testid={`text-version-${engine.instanceId}`}>{info.current}</span> : null}
      {info?.available ? <Badge data-testid={`badge-upgrade-${engine.instanceId}`}>Upgrade available</Badge> : null}
    </>
  );
}

/** Whether the engine is connected and healthy, when it last reported in, and the channel it acts on. */
function EngineStatus({ engine }: { engine: OrgEngine }) {
  const now = useMinuteClock();
  const health = engineHealth({
    engine,
    linkNeedsReconnect: engine.linkNeedsReconnect,
    lastEngineActivityAt: engine.lastEngineActivityAt,
  });
  return (
    <div className="space-y-1 text-sm" data-testid={`status-engine-${engine.instanceId}`}>
      <p className={cn("flex items-center gap-2 font-medium", TONE_CLASS[health.tone])}>
        <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
        <span data-testid={`text-health-${engine.instanceId}`}>{health.label}</span>
      </p>
      {health.reasons.map((reason) => (
        <p key={reason} className="text-muted-foreground">
          {reason}
        </p>
      ))}
      <p className="text-muted-foreground">
        {engine.lastEngineActivityAt === null
          ? "Not connected yet"
          : `Last active ${formatAgo(engine.lastEngineActivityAt, now)}`}
        {engine.linkedChannel ? ` · ${engine.linkedChannel.name} on ${engine.linkedChannel.platform}` : ""}
      </p>
    </div>
  );
}

/** The first thing a person without an engine sees: one big way to make one. */
function CreateEngineCta() {
  const selection = useOptionalOrganization();
  const organization = selection?.organization ?? null;
  return (
    <Card className="border-dashed" data-testid="card-create-engine">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-2xl">Set up your stream</CardTitle>
        <CardDescription className="max-w-md">
          Alerts, overlays and chat commands live here. We&apos;ll walk you through it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-8">
        {organization === null ? (
          <Button asChild size="lg">
            <Link href="/auth/onboarding" data-testid="link-set-up-engine">
              Set up your stream
            </Link>
          </Button>
        ) : organization.can.createEngine ? (
          <NewEngineDialog accountId={organization.accountId} label="Create your woofx3" size="lg" />
        ) : (
          <p className="text-sm text-muted-foreground">Ask the account owner to create one.</p>
        )}
      </CardContent>
    </Card>
  );
}

interface EngineRow {
  engine: OrgEngine;
  /** The organization the engine belongs to, set where the list spans several. */
  organization: MyOrganization;
}

/**
 * The engines the person can reach. In an organization's scope that is all of its engines, with creating and renaming
 * for the roles that may; in the personal scope it is every engine they can open across their organizations.
 */
export function EngineList() {
  const selection = useOptionalOrganization();
  const portal = useOptionalPortalScope();
  const [, navigate] = useLocation();

  const scoped = selection?.organization ?? null;
  const rows: EngineRow[] =
    scoped === null
      ? (portal?.organizations ?? []).flatMap((organization) =>
          organization.engines.filter((engine) => engine.canOpen).map((engine) => ({ engine, organization }))
        )
      : scoped.engines.map((engine) => ({ engine, organization: scoped }));
  if (rows.length === 0) {
    return <CreateEngineCta />;
  }
  const labels = organizationLabels(portal?.organizations ?? []);

  function openDashboard(instanceId: Id<"instances">) {
    $currentInstanceId.set(instanceId);
    navigate("/");
  }

  return (
    <section className="space-y-3" aria-labelledby="heading-engines">
      <div className="flex items-center justify-between gap-3">
        <h2 id="heading-engines" className="text-lg font-semibold">
          Your woofx3
        </h2>
        {scoped?.can.createEngine ? <NewEngineDialog accountId={scoped.accountId} /> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ engine, organization }) => (
          <Card key={engine.instanceId} data-testid={`row-engine-${engine.instanceId}`}>
            <CardHeader>
              <CardTitle className="truncate">{engine.name}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{engine.hosting === "managed" ? "Hosted" : "Self-hosted"}</Badge>
                <EngineVersion engine={engine} enabled={scoped?.can.manageEngines === true} />
                {scoped === null ? <span>· {labels.get(organization.accountId) ?? organization.name}</span> : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <EngineStatus engine={engine} />
              <div className="flex flex-wrap gap-2">
                {engine.canOpen ? (
                  <Button
                    onClick={() => openDashboard(engine.instanceId)}
                    data-testid={`button-launch-${engine.instanceId}`}
                  >
                    Launch dashboard
                  </Button>
                ) : null}
                {scoped !== null && engine.canOpen ? (
                  <Button asChild variant="outline" data-testid={`button-manage-${engine.instanceId}`}>
                    <Link href={enginePath(engine.instanceId)}>Manage</Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
