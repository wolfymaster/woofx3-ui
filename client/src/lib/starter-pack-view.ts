import {
  missingRequirements,
  requirementsMessage,
  type StarterCatalog,
  type StarterFieldValues,
  type StarterItem,
  type StarterPack,
  type StarterStep,
  starterItemKey,
} from "@convex/lib/starterPacks";
import type { StarterItemState } from "@convex/starterPacks";

export type StarterItemView =
  | { state: "installed" | "installing" | "ready" }
  | { state: "conflict" | "unavailable"; reason: string };

/**
 * What the page shows for one item. An installed item stays installed even if
 * the catalog has since lost something it needs; only an item still to be
 * installed is held back by a missing requirement.
 */
export function starterItemView(
  pack: StarterPack,
  item: StarterItem,
  catalog: StarterCatalog,
  states: Record<string, StarterItemState>
): StarterItemView {
  const state = states[starterItemKey(pack.id, item.id)] ?? "available";
  if (state === "installed" || state === "installing") {
    return { state };
  }
  const blocked = requirementsMessage(missingRequirements(item, catalog));
  if (blocked !== null) {
    return { state: "unavailable", reason: blocked };
  }
  if (state === "conflict") {
    return { state: "conflict", reason: "Name already taken" };
  }
  return { state: "ready" };
}

export interface StarterPackSummary {
  total: number;
  installed: number;
  /** Items an install would create now. */
  ready: number;
  /** Why the pack cannot be installed at all, when nothing in it is ready and something is held back. */
  blockedReason: string | null;
}

export function starterPackSummary(views: StarterItemView[]): StarterPackSummary {
  const installed = views.filter((view) => view.state === "installed").length;
  const ready = views.filter((view) => view.state === "ready").length;
  const held = views.find((view) => view.state === "unavailable");
  return {
    total: views.length,
    installed,
    ready,
    blockedReason: ready === 0 && held?.state === "unavailable" ? held.reason : null,
  };
}

/** How the preview names a step, with the pause length a delay will actually have. */
export function starterStepLabel(step: StarterStep, values: StarterFieldValues): string | null {
  if (step.kind === "action") {
    return step.label;
  }
  const seconds = values[step.seconds.field];
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return step.label;
  }
  if (seconds === 0) {
    return null;
  }
  return `${step.label} ${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function starterItemTitle(item: StarterItem): string {
  return item.kind === "workflow" ? item.name : `!${item.command}`;
}

export function starterItemTrigger(item: StarterItem): string {
  return item.kind === "workflow" ? item.trigger.label : `Someone types !${item.command}`;
}
