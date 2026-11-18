import { useState } from "react";
import { Link } from "wouter";
import { ALERT_GROUPS_PATH, NEW_ALERT_GROUP_SEGMENT } from "@/components/alerts/workflow-group-pages";
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
 * The group checkboxes for the trigger being edited. Inline in the page — no menu, popover
 * or dialog — so it can sit inside the one bottom Advanced disclosure alongside Step name
 * and the link to the full editor. Hidden on an engine without groups.
 */
export function InlineGroupPicker({ workflows }: { workflows: readonly Workflow[] }) {
  const supported = useWorkflowGroupsSupported();
  if (!supported) {
    return null;
  }
  return <GroupPicker workflows={workflows} />;
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
    <div className="flex flex-col gap-2" data-testid="inline-group-picker">
      <span className="text-[13px] font-medium">Group</span>
      {sorted.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No groups yet.</p>
      ) : (
        sorted.map((group) => (
          <div key={group.engineGroupId} className="flex items-center gap-2 text-[13px]">
            <input
              id={`trigger-group-${group.engineGroupId}`}
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={inGroups.includes(group.engineGroupId)}
              disabled={pending}
              onChange={(event) => void toggle(group.engineGroupId, event.target.checked)}
              data-testid={`trigger-group-${group.engineGroupId}`}
            />
            <label htmlFor={`trigger-group-${group.engineGroupId}`}>{group.name}</label>
          </div>
        ))
      )}
      <Link
        href={`${ALERT_GROUPS_PATH}/${NEW_ALERT_GROUP_SEGMENT}`}
        className="self-start text-[13px] text-muted-foreground underline"
      >
        Make a new group
      </Link>
    </div>
  );
}
