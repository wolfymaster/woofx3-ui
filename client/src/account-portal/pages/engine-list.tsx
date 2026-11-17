import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgEngine } from "@convex/organizations";
import { useMutation } from "convex/react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { $currentInstanceId } from "@/lib/stores";
import { NewEngineDialog } from "../new-engine-dialog";
import { useOrganization } from "../organization-context";
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

export default function EnginesPage() {
  const { organization } = useOrganization();
  const renameEngine = useMutation(api.instances.update);
  const [, navigate] = useLocation();

  function openDashboard(instanceId: Id<"instances">) {
    $currentInstanceId.set(instanceId);
    navigate("/");
  }

  return (
    <>
      <PageHeader
        title="Engines"
        description={
          organization.can.manageEngines
            ? "Every engine in this organization."
            : "The engines in this organization you can open."
        }
        actions={organization.can.createEngine ? <NewEngineDialog accountId={organization.accountId} /> : null}
      />
      <Card>
        <CardContent>
          {organization.engines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No engines yet.</p>
          ) : (
            <ul className="divide-y">
              {organization.engines.map((engine) => (
                <li
                  key={engine.instanceId}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`row-engine-${engine.instanceId}`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                    <span className="font-medium truncate">{engine.name}</span>
                    <Badge variant="outline">{engine.hosting === "managed" ? "Hosted" : "Self-hosted"}</Badge>
                    <span className="text-sm text-muted-foreground">{engineStatus(engine)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {engine.canOpen ? (
                      <Button size="sm" onClick={() => openDashboard(engine.instanceId)}>
                        Open dashboard
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
