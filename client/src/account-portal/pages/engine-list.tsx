import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgEngine } from "@convex/organizations";
import { useMutation } from "convex/react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { $currentInstanceId } from "@/lib/stores";
import { NewEngineDialog } from "../new-engine-dialog";
import { useOptionalOrganization } from "../organization-context";
import { RenameDialog } from "../rename-dialog";

const STATUS_LABELS: Record<NonNullable<OrgEngine["status"]>, string> = {
  requested: "Setting up",
  provisioning: "Setting up",
  ready: "Setting up",
  registering: "Setting up",
  registered: "Running",
  upgrading: "Upgrading",
  failed: "Failed",
  deprovisioning: "Being deleted",
  deleted: "Deleted",
  stopping: "Pausing",
  stopped: "Paused",
  starting: "Starting",
};

function engineStatus(engine: OrgEngine): string {
  if (engine.hosting === "external") {
    return "No subscription needed";
  }
  return engine.status === null ? "Not set up" : STATUS_LABELS[engine.status];
}

/** The first thing a person without an engine sees: one big way to make one. */
function CreateEngineCta() {
  const selection = useOptionalOrganization();
  const organization = selection?.organization ?? null;
  return (
    <Card className="border-dashed" data-testid="card-create-engine">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-2xl">Create your streaming engine</CardTitle>
        <CardDescription className="max-w-md">
          Your engine runs your alerts, overlays and chat commands. We&apos;ll walk you through setting it up.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-8">
        {organization === null ? (
          <Button asChild size="lg">
            <Link href="/auth/onboarding" data-testid="link-set-up-engine">
              Set up a streaming engine
            </Link>
          </Button>
        ) : organization.can.createEngine ? (
          <NewEngineDialog accountId={organization.accountId} label="Create an engine" size="lg" />
        ) : (
          <p className="text-sm text-muted-foreground">Ask an owner of this organization to create one.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Every engine the person can reach in the organization, each with a way straight into its dashboard. */
export function EngineList() {
  const selection = useOptionalOrganization();
  const renameEngine = useMutation(api.instances.update);
  const [, navigate] = useLocation();

  if (selection === null || selection.organization.engines.length === 0) {
    return <CreateEngineCta />;
  }
  const { organization } = selection;

  function openDashboard(instanceId: Id<"instances">) {
    $currentInstanceId.set(instanceId);
    navigate("/");
  }

  return (
    <section className="space-y-3" aria-labelledby="heading-engines">
      <div className="flex items-center justify-between gap-3">
        <h2 id="heading-engines" className="text-lg font-semibold">
          Engines
        </h2>
        {organization.can.createEngine ? <NewEngineDialog accountId={organization.accountId} /> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {organization.engines.map((engine) => (
          <Card key={engine.instanceId} data-testid={`row-engine-${engine.instanceId}`}>
            <CardHeader>
              <CardTitle className="truncate">{engine.name}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{engine.hosting === "managed" ? "Hosted" : "Self-hosted"}</Badge>
                <span>{engineStatus(engine)}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {engine.canOpen ? (
                <Button
                  onClick={() => openDashboard(engine.instanceId)}
                  data-testid={`button-launch-${engine.instanceId}`}
                >
                  Launch dashboard
                </Button>
              ) : null}
              {organization.can.renameEngine && engine.canOpen ? (
                <RenameDialog
                  title="Rename engine"
                  current={engine.name}
                  onRename={(name) => renameEngine({ instanceId: engine.instanceId, name })}
                  testId={`button-rename-engine-${engine.instanceId}`}
                />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
