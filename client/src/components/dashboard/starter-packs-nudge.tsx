import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { PackagePlus } from "lucide-react";
import { Link } from "wouter";
import { STARTER_PACKS_PATH } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";

/**
 * Points an instance with no workflows at the starter packs. Renders nothing
 * until the query confirms the instance is empty, so it never flashes for an
 * instance that has workflows.
 */
export function StarterPacksNudge({ instanceId }: { instanceId: Id<"instances"> }) {
  const hasWorkflows = useQuery(api.workflows.hasAny, { instanceId });
  if (hasWorkflows !== false) {
    return null;
  }
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border bg-primary/5 shrink-0"
      data-testid="banner-starter-packs"
    >
      <div className="flex items-center gap-2 text-sm">
        <PackagePlus className="h-4 w-4 text-primary shrink-0" />
        <span>Your stream has no automations yet. Thank followers, welcome raiders and hype subs in one click.</span>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href={STARTER_PACKS_PATH}>Browse starter packs</Link>
      </Button>
    </div>
  );
}
