import type { Workflow, WorkflowGroup } from "@/engine/types";
import { conditionFieldsOf, eventTriggers, groupEventTriggers, unownedConditionPhrases } from "@/lib/alert-triggers";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * A trigger card as an alert group sees it: every workflow the Alerts screen
 * shows as one card (same event, same conditions). Groups hold workflows, so a
 * card joins or leaves a group as all of its workflows at once.
 */
export interface GroupableCard {
  key: string;
  event: string;
  /** What happened, as the trigger catalog names it. */
  eventLabel: string;
  /** Its conditions in words; empty when it fires on every such event. */
  conditionsLabel: string;
  workflows: Workflow[];
}

/** The engine workflow ids a card stands for. */
export function cardWorkflowIds(card: GroupableCard): string[] {
  return card.workflows.map((workflow) => workflow.engineWorkflowId);
}

/** The groups every one of `workflows` is in. */
export function commonGroupIds(workflows: readonly Workflow[]): string[] {
  const [first, ...rest] = workflows;
  if (!first) {
    return [];
  }
  return first.groupIds.filter((groupId) => rest.every((workflow) => workflow.groupIds.includes(groupId)));
}

/** The groups a card is in: those all of its workflows are in. A card half in a group is not in it. */
export function cardGroupIds(card: GroupableCard): string[] {
  return commonGroupIds(card.workflows);
}

/** Every trigger card on the instance, by event label and then in the order the Alerts screen lists them. */
export function groupableCards(workflows: readonly Workflow[], presets: readonly TriggerPreset[]): GroupableCard[] {
  const presetByEvent = new Map(presets.filter((p) => p.event).map((p) => [p.event as string, p]));
  const events = new Set<string>();
  for (const workflow of workflows) {
    const trigger = (workflow.definition as { trigger?: { type?: unknown; event?: unknown } } | undefined)?.trigger;
    if (trigger?.type === "event" && typeof trigger.event === "string") {
      events.add(trigger.event);
    }
  }
  const cards: GroupableCard[] = [];
  for (const event of events) {
    const preset = presetByEvent.get(event);
    const fields = conditionFieldsOf(preset);
    for (const group of groupEventTriggers(eventTriggers(workflows, event))) {
      cards.push({
        key: `${event}|${group.key}`,
        event,
        eventLabel: preset?.name ?? event,
        conditionsLabel: unownedConditionPhrases(group.conditions, fields).join(", "),
        workflows: group.members.map((member) => member.row),
      });
    }
  }
  return cards.sort((a, b) => a.eventLabel.localeCompare(b.eventLabel));
}

/** The cards a group holds, as its page lists them: those all of whose workflows are in it. */
export function cardsInGroup(cards: readonly GroupableCard[], engineGroupId: string): GroupableCard[] {
  return cards.filter((card) => cardGroupIds(card).includes(engineGroupId));
}

/**
 * How many of a group's cards go back to how they were when it is switched
 * off or deleted: those with a workflow no other group that is on still
 * holds. None while the group is off, since its cards then follow their own
 * switches.
 */
export function cardsReleasedBy(
  group: WorkflowGroup,
  groups: readonly WorkflowGroup[],
  cards: readonly GroupableCard[]
): number {
  if (!group.enabled) {
    return 0;
  }
  const heldElsewhere = new Set(
    groups.filter((other) => other.enabled && other.engineGroupId !== group.engineGroupId).flatMap((g) => g.memberIds)
  );
  return cardsInGroup(cards, group.engineGroupId).filter((card) =>
    cardWorkflowIds(card).some((id) => !heldElsewhere.has(id))
  ).length;
}
