import { Layers } from "lucide-react";
import { useLocation } from "wouter";
import { WorkflowGroupPages } from "@/components/alerts/workflow-group-pages";
import { EmptyState } from "@/components/common/empty-state";
import { useWorkflowGroupsSupported } from "@/engine/hooks/use-workflow-groups";
import { ALERT_GROUPS_PATH } from "@/lib/alert-groups-route";
import { subPathSegments } from "@/lib/route-subpath";

/** Sets of alert triggers switched on and off together; the path below the route picks the list or one group. */
export default function AlertGroups() {
  const [location] = useLocation();
  const supported = useWorkflowGroupsSupported();

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-8 pt-6 sm:px-6 sm:pt-16">
      {supported ? (
        <WorkflowGroupPages route={subPathSegments(location, ALERT_GROUPS_PATH)} />
      ) : (
        <EmptyState
          icon={Layers}
          title="Alert groups need a newer engine"
          description="This engine doesn't have alert groups yet. Update it to make sets of triggers you switch on and off together."
        />
      )}
    </div>
  );
}
