import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgEngine } from "@convex/organizations";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { $currentInstanceId } from "@/lib/stores";
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Engines</CardTitle>
          <CardDescription>
            {organization.can.createEngine
              ? "Every engine in this organization."
              : "The engines in this organization you can open."}
          </CardDescription>
        </div>
        {organization.can.createEngine ? (
          <Button asChild data-testid="button-create-engine">
            <Link href="/auth/onboarding">
              <Plus className="h-4 w-4 mr-2" />
              Create another engine
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {organization.engines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No engines yet.</p>
        ) : (
          <Table>
            <TableBody>
              {organization.engines.map((engine) => (
                <TableRow key={engine.instanceId} data-testid={`row-engine-${engine.instanceId}`}>
                  <TableCell className="font-medium">{engine.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{engine.hosting === "managed" ? "Hosted" : "Self-hosted"}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{engineStatus(engine)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {engine.canOpen ? (
                        <Button size="sm" onClick={() => openDashboard(engine.instanceId)}>
                          Open dashboard
                        </Button>
                      ) : null}
                      {organization.can.createEngine && engine.canOpen ? (
                        <RenameDialog
                          title="Rename engine"
                          current={engine.name}
                          onRename={(name) => renameEngine({ instanceId: engine.instanceId, name })}
                          testId={`button-rename-engine-${engine.instanceId}`}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
