import { formatStorageBytes } from "@convex/lib/hostedStorage";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useModuleStorageUsage } from "@/engine/hooks/use-module-storage-usage";
import type { InstanceId, ModuleStorageUsage } from "@/engine/types";

/**
 * Said wherever module storage is over its limit. The limit is never enforced,
 * so this is the only thing the owner hears about it, and it says plainly what
 * is at risk.
 */
export function ModuleStorageOverLimitAlert({ usage, className }: { usage: ModuleStorageUsage; className?: string }) {
  if (!usage.over || usage.limitBytes === null) {
    return null;
  }
  return (
    <Alert className={className} data-testid="module-storage-over-limit">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Your modules are storing more than your plan includes</AlertTitle>
      <AlertDescription>
        They hold {formatStorageBytes(usage.usedBytes)} of the {formatStorageBytes(usage.limitBytes)} your plan
        includes. Your modules keep working, but data they store beyond the limit could be lost.
      </AlertDescription>
    </Alert>
  );
}

/** Module storage on a managed engine against its plan's limit, for the engine page. */
export function ModuleStorageCard({ instanceId }: { instanceId: InstanceId }) {
  const { usage } = useModuleStorageUsage(instanceId);
  return (
    <Card data-testid="module-storage-card">
      <CardHeader>
        <CardTitle>Module storage</CardTitle>
        <CardDescription>What your installed modules save, such as counters, lists and settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage === null ? (
          <p className="text-sm text-muted-foreground">
            Your engine can't report this yet. Update it to the latest release to see how much your modules use.
          </p>
        ) : (
          <ModuleStorageMeter usage={usage} />
        )}
        {usage && <ModuleStorageOverLimitAlert usage={usage} />}
      </CardContent>
    </Card>
  );
}

function ModuleStorageMeter({ usage }: { usage: ModuleStorageUsage }) {
  if (usage.limitBytes === null) {
    return <p className="text-sm">{formatStorageBytes(usage.usedBytes)} used</p>;
  }
  const percent = usage.limitBytes === 0 ? 100 : Math.min(100, (usage.usedBytes / usage.limitBytes) * 100);
  return (
    <div className="max-w-sm" data-testid="module-storage-meter">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-muted-foreground">Used</span>
        <span>
          {formatStorageBytes(usage.usedBytes)} of {formatStorageBytes(usage.limitBytes)}
        </span>
      </div>
      <Progress value={percent} aria-label="Module storage used" />
    </div>
  );
}
