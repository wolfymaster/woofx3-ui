import type { StepNode } from "@/lib/workflow-tree";

/**
 * Reading an uninstall refusal, and what the dialog can remove to clear it.
 *
 * Most entries are a resource of the module that something still uses: a
 * trigger a workflow listens to, an action one of its steps runs, a theme a
 * scene's widget wears. An entry whose `resourceType` is `module` is the whole
 * module, which other installed modules declare in their `requires`; the
 * engine names each dependent as a `module` source whose context is the range
 * it requires (`requires ^1.2.0`). An entry with no users at all is a resource
 * the streamer made with the module (`instance:<kind>`, a counter or a queue).
 */

export const MODULE_DEPENDENCY_RESOURCE_TYPE = "module";

/** The engine's `context` for a workflow that listens to the module's trigger. */
const WORKFLOW_TRIGGER_CONTEXT = "trigger";
/** The engine's `context` for a workflow step: `step[2]`, or `step[2].function` for the function it calls. */
const WORKFLOW_STEP_CONTEXT = /^step\[\d+\]/;
const THEME_RESOURCE_TYPE = "theme";
const INSTANCE_RESOURCE_PREFIX = "instance:";

export type UsedByEntry = {
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  context?: string;
};

export type ConflictResource = {
  resourceType?: string;
  resourceId?: string;
  /** Canonical id (`twitch_platform:trigger:twitch.channel.cheer`): what references point at. */
  resourceName?: string;
  /** The engine's display name for it ("Channel Cheer"), when it could resolve one. */
  resourceDisplayName?: string;
  usedBy?: UsedByEntry[];
};

/**
 * What removing a row does. `workflow` deletes the whole workflow, since its
 * trigger is the module's; `steps` takes the steps running the module's action
 * out of it; `widgets` takes the widgets wearing the module's theme off a
 * scene. `none` is a row the dialog can only point at.
 */
export type UsageFix = "workflow" | "steps" | "widgets" | "none";

export interface UsageRow {
  key: string;
  fix: UsageFix;
  resource: ConflictResource;
  /** Absent for a resource no one else uses, such as a counter made with the module. */
  user?: UsedByEntry;
}

function fixOf(resource: ConflictResource, user: UsedByEntry): UsageFix {
  if (!user.sourceId || !resource.resourceName) {
    return "none";
  }
  if (user.sourceType === "workflow" && user.context === WORKFLOW_TRIGGER_CONTEXT) {
    return "workflow";
  }
  if (user.sourceType === "workflow" && WORKFLOW_STEP_CONTEXT.test(user.context ?? "")) {
    return "steps";
  }
  if (user.sourceType === "scene" && resource.resourceType === THEME_RESOURCE_TYPE) {
    return "widgets";
  }
  return "none";
}

/**
 * One row per thing to clear. A workflow on the module's trigger is one row,
 * since deleting it also clears every step of it; otherwise a source is one
 * row per resource it uses, however many of its steps or widgets use it.
 */
export function usageRows(conflicts: readonly ConflictResource[]): UsageRow[] {
  const deletedWorkflows = new Set<string>();
  for (const resource of conflicts) {
    for (const user of resource.usedBy ?? []) {
      if (fixOf(resource, user) === "workflow" && user.sourceId) {
        deletedWorkflows.add(user.sourceId);
      }
    }
  }
  const rows = new Map<string, UsageRow>();
  conflicts.forEach((resource, resourceIndex) => {
    const resourceKey = resource.resourceId ?? resource.resourceName ?? `resource-${resourceIndex}`;
    const users = resource.usedBy ?? [];
    if (users.length === 0) {
      rows.set(resourceKey, { key: resourceKey, fix: "none", resource });
      return;
    }
    users.forEach((user, userIndex) => {
      const fix = fixOf(resource, user);
      if (fix === "steps" && user.sourceId && deletedWorkflows.has(user.sourceId)) {
        return;
      }
      const source = `${user.sourceType ?? "source"}:${user.sourceId ?? userIndex}`;
      const key = fix === "workflow" ? source : `${source}:${resourceKey}`;
      if (!rows.has(key)) {
        rows.set(key, { key, fix, resource, user });
      }
    });
  });
  return Array.from(rows.values());
}

/** Ids of the action steps anywhere in a workflow that run the given action or call the given function. */
export function stepIdsUsing(steps: readonly StepNode[], canonicalId: string): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.type === "action" && (step.ref === canonicalId || step.function === canonicalId)) {
      ids.push(step.id);
    } else if (step.type === "condition") {
      ids.push(...stepIdsUsing(step.thenBranch, canonicalId), ...stepIdsUsing(step.elseBranch, canonicalId));
    }
  }
  return ids;
}

function wearsTheme(value: unknown, themeId: string): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const settings = (value as { settings?: unknown }).settings;
  return typeof settings === "object" && settings !== null && (settings as { theme?: unknown }).theme === themeId;
}

function widgetName(value: unknown): string | undefined {
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * A scene's widgets without those wearing the theme, at any depth: a widget
 * placed inside another's settings (an alert layout) is taken out of that
 * layout, not with the widget holding it. Also the names of what came off.
 */
export function withoutThemedWidgets(value: unknown, themeId: string): { value: unknown; removed: string[] } {
  const removed: string[] = [];
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node
        .filter((item) => {
          if (wearsTheme(item, themeId)) {
            removed.push(widgetName(item) ?? "Widget");
            return false;
          }
          return true;
        })
        .map(walk);
    }
    if (typeof node === "object" && node !== null) {
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) {
        if (wearsTheme(item, themeId)) {
          removed.push(widgetName(item) ?? "Widget");
          continue;
        }
        next[key] = walk(item);
      }
      return next;
    }
    return node;
  };
  return { value: walk(value), removed };
}

/** The note on a row the dialog can't clear itself, saying where to clear it. */
export function manualFixNote(row: UsageRow): string {
  const type = row.resource.resourceType ?? "";
  if (type === MODULE_DEPENDENCY_RESOURCE_TYPE) {
    const range = row.user?.context ? ` (${row.user.context})` : "";
    return `Needs this module${range}. Uninstall it first.`;
  }
  if (type.startsWith(INSTANCE_RESOURCE_PREFIX)) {
    return `A ${type.slice(INSTANCE_RESOURCE_PREFIX.length)} made with this module. Delete it first.`;
  }
  if (row.user?.sourceType === "command") {
    return "A chat command runs it. Remove that action from the command.";
  }
  return "Remove it where it's set up, then try again.";
}
