import { type BindableResourceKind, type PageContent, pageBindings, USER_PAGE_LIMITS } from "@shared/user-pages";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * The values a published page shows, kept apart from `resourceValues` so a
 * public read can only ever reach a value some published page binds: a row
 * exists here for exactly the resources the instance's published revision
 * binds. Publishing rebuilds the rows; value and settings changes refresh a
 * row only when one exists, so a change to anything unbound costs one index
 * lookup and writes nothing.
 */

/**
 * The settings a visitor's browser needs to read each kind's value: what
 * `counterValue`, `counterGoals` and `timerState` in
 * client/src/lib/resource-values.ts read, which this must match, and what
 * parseFormDefinition reads. Nothing else an instance was created with is
 * published.
 */
const PUBLIC_SETTING_KEYS: Record<BindableResourceKind, readonly string[]> = {
  "woofx3:counter": ["initialValue", "goals"],
  "woofx3:timer": ["duration"],
  "woofx3:form": ["title", "submitLabel", "fields"],
};

export function publicSettings(kind: BindableResourceKind, settings: unknown): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return picked;
  }
  const source = settings as Record<string, unknown>;
  for (const key of PUBLIC_SETTING_KEYS[kind]) {
    if (key in source && source[key] !== undefined) {
      picked[key] = source[key];
    }
  }
  return picked;
}

/**
 * Stored values are plain Convex values, so equal JSON means equal values. An
 * object with its keys in another order reads as changed, which costs only a
 * write.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function stateRow(ctx: MutationCtx, instanceId: Id<"instances">, canonicalId: string) {
  return ctx.db
    .query("userPageState")
    .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId).eq("canonicalId", canonicalId))
    .unique();
}

/**
 * Makes the rows match what `content` binds, from the current mirrored values
 * and settings: called on publish with the published content, and with null
 * when the page goes offline or is deleted.
 */
export async function rebuildPageState(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  content: PageContent | null
): Promise<void> {
  const wanted = new Map(
    (content ? pageBindings(content.sections) : []).map((binding) => [binding.canonicalId, binding])
  );
  // One row per binding, and a page binds at most one resource per widget.
  const existing = await ctx.db
    .query("userPageState")
    .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId))
    .take(USER_PAGE_LIMITS.widgetsPerPage + 1);
  for (const row of existing) {
    if (!wanted.has(row.canonicalId)) {
      await ctx.db.delete(row._id);
    }
  }

  const now = Date.now();
  for (const binding of wanted.values()) {
    const [value, resource] = await Promise.all([
      ctx.db
        .query("resourceValues")
        .withIndex("by_instance_canonical", (q) =>
          q.eq("instanceId", instanceId).eq("canonicalId", binding.canonicalId)
        )
        .first(),
      ctx.db
        .query("moduleResourceInstances")
        .withIndex("by_instance_canonical", (q) =>
          q.eq("instanceId", instanceId).eq("canonicalId", binding.canonicalId)
        )
        .first(),
    ]);
    const fields = {
      instanceId,
      canonicalId: binding.canonicalId,
      kind: binding.kind,
      value: value?.value ?? null,
      settings: publicSettings(binding.kind, resource?.settings),
      updatedAt: now,
    };
    const row = existing.find((candidate) => candidate.canonicalId === binding.canonicalId);
    if (row) {
      await ctx.db.replace(row._id, fields);
    } else {
      await ctx.db.insert("userPageState", fields);
    }
  }
}

/**
 * A resource's value changed. Written through only when a published page
 * binds it and the value differs, so an unchanged value does not re-run every
 * visitor's subscription.
 */
export async function refreshPageStateValue(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  canonicalId: string,
  value: unknown
): Promise<void> {
  const row = await stateRow(ctx, instanceId, canonicalId);
  if (!row || sameValue(row.value, value)) {
    return;
  }
  await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
}

/** A resource was deleted: a published form then reads as unavailable rather than taking answers for it. */
export async function dropPageState(ctx: MutationCtx, instanceId: Id<"instances">, canonicalId: string): Promise<void> {
  const row = await stateRow(ctx, instanceId, canonicalId);
  if (row) {
    await ctx.db.delete(row._id);
  }
}

/** A resource's settings changed: the same, for the settings a visitor sees. */
export async function refreshPageStateSettings(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  canonicalId: string,
  settings: unknown
): Promise<void> {
  const row = await stateRow(ctx, instanceId, canonicalId);
  if (!row) {
    return;
  }
  const picked = publicSettings(row.kind, settings);
  if (sameValue(row.settings, picked)) {
    return;
  }
  await ctx.db.patch(row._id, { settings: picked, updatedAt: Date.now() });
}
