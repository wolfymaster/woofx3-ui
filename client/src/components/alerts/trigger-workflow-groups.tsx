import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { ALERT_GROUPS_PATH, NEW_ALERT_GROUP_SEGMENT } from "@/components/alerts/workflow-group-pages";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAddWorkflowGroupMembersRequest,
  useRemoveWorkflowGroupMembersRequest,
  useWorkflowGroups,
  useWorkflowGroupsSupported,
} from "@/engine/hooks/use-workflow-groups";
import type { Workflow } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";
import { commonGroupIds } from "@/lib/workflow-groups";

/**
 * The alert groups a trigger card is in, as chips beside its Paused pill. Shows
 * nothing for a card in no group, which is every card on an engine without
 * groups, so such a card asks the engine nothing.
 */
export function TriggerGroupChips({ workflows }: { workflows: readonly Workflow[] }) {
  const groupIds = commonGroupIds(workflows);
  if (groupIds.length === 0) {
    return null;
  }
  return <GroupChips groupIds={groupIds} />;
}

function GroupChips({ groupIds }: { groupIds: string[] }) {
  const groups = useWorkflowGroups();
  const names = (groups ?? []).filter((group) => groupIds.includes(group.engineGroupId)).map((group) => group.name);
  return (
    <>
      {names.map((name) => (
        <span
          key={name}
          className="shrink-0 rounded-full border px-2 py-px text-xs text-foreground/80"
          data-testid="trigger-group-chip"
        >
          {name}
        </span>
      ))}
    </>
  );
}

/**
 * A trigger card's advanced settings: which alert groups it is in. Joining or
 * leaving applies to every workflow on the card. Hidden on an engine without groups.
 */
export function TriggerAdvancedSettings({ workflows }: { workflows: readonly Workflow[] }) {
  const supported = useWorkflowGroupsSupported();
  const [open, setOpen] = useState(false);
  if (!supported) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 self-start text-[13px] text-muted-foreground hover:text-foreground"
        data-testid="trigger-advanced-toggle"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Advanced
      </button>
      {open && <GroupPicker workflows={workflows} />}
    </div>
  );
}

function GroupPicker({ workflows }: { workflows: readonly Workflow[] }) {
  const groups = useWorkflowGroups();
  const addMembers = useAddWorkflowGroupMembersRequest();
  const removeMembers = useRemoveWorkflowGroupMembersRequest();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const inGroups = commonGroupIds(workflows);
  const workflowIds = workflows.map((workflow) => workflow.engineWorkflowId);
  const sorted = [...(groups ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = sorted.filter((group) => inGroups.includes(group.engineGroupId)).map((group) => group.name);

  async function toggle(engineGroupId: string, join: boolean) {
    setPending(true);
    try {
      await (join ? addMembers : removeMembers)(engineGroupId, workflowIds);
    } catch (err: unknown) {
      toast({
        title: join ? "Couldn't add the trigger to the group" : "Couldn't take the trigger out of the group",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[13px] text-muted-foreground">Groups</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending} data-testid="trigger-groups-select">
            {chosen.length === 0 ? "None" : chosen.join(", ")}
            <ChevronDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {sorted.length === 0 ? (
            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No groups yet.</p>
          ) : (
            sorted.map((group) => (
              <DropdownMenuCheckboxItem
                key={group.engineGroupId}
                checked={inGroups.includes(group.engineGroupId)}
                onCheckedChange={(checked) => void toggle(group.engineGroupId, checked === true)}
              >
                {group.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Link
        href={`${ALERT_GROUPS_PATH}/${NEW_ALERT_GROUP_SEGMENT}`}
        className="text-[13px] text-muted-foreground underline"
      >
        Make a new group
      </Link>
    </div>
  );
}
