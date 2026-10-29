import { type PageContent, type PageProblem, type ResourceBinding, widgetBindings } from "@shared/user-pages";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { parseKindRef } from "./resourceKinds";

/** Provisioning states in which the maintenance API no longer holds the engine's slug for it. */
const SLUG_RELEASED_STATUSES: ReadonlySet<Doc<"engineProvisioning">["status"]> = new Set(["deprovisioning", "deleted"]);

/**
 * The name a page is published under: its managed engine's slug, once the
 * maintenance API has allocated it (`maintenanceEngineId` is set when it
 * answers) and until the engine is torn down. Null for every other instance,
 * which has no name to publish under.
 */
export async function pageSlugForInstance(ctx: QueryCtx, instanceId: Id<"instances">): Promise<string | null> {
  const provisioning = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (!provisioning || provisioning.maintenanceEngineId === undefined) {
    return null;
  }
  return SLUG_RELEASED_STATUSES.has(provisioning.status) ? null : provisioning.slug;
}

export async function userPageForInstance(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<Doc<"userPages"> | null> {
  return ctx.db
    .query("userPages")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
}

/** A revision the page points at. Missing means the page row is corrupt, which nothing should paper over. */
export async function requireRevision(
  ctx: QueryCtx,
  revisionId: Id<"userPageRevisions">
): Promise<Doc<"userPageRevisions">> {
  const revision = await ctx.db.get(revisionId);
  if (!revision) {
    throw new Error(`User page revision ${revisionId} does not exist`);
  }
  return revision;
}

/** Whether the resource is an instance of `kind` (`{module}:{kind}`), by its canonical id `{module}:{kind}:{id}`. */
function isOfKind(row: Doc<"moduleResourceInstances">, kind: ResourceBinding["kind"]): boolean {
  const parsed = parseKindRef(kind);
  return parsed !== null && row.kind === parsed.kind && row.canonicalId.startsWith(`${kind}:`);
}

/**
 * Bindings in `content` to resources the instance does not have, or has as
 * another kind. A widget left unbound is the widget's own problem, reported
 * by its check, so it is skipped here.
 */
export async function bindingProblems(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  content: PageContent
): Promise<PageProblem[]> {
  const problems: PageProblem[] = [];
  const rows = new Map<string, Doc<"moduleResourceInstances"> | null>();
  for (const [sectionIndex, section] of content.sections.entries()) {
    for (const [widgetIndex, widget] of section.widgets.entries()) {
      for (const binding of widgetBindings(widget)) {
        if (binding.canonicalId.trim() === "") {
          continue;
        }
        let row = rows.get(binding.canonicalId);
        if (row === undefined) {
          row = await ctx.db
            .query("moduleResourceInstances")
            .withIndex("by_instance_canonical", (q) =>
              q.eq("instanceId", instanceId).eq("canonicalId", binding.canonicalId)
            )
            .first();
          rows.set(binding.canonicalId, row);
        }
        if (!row || !isOfKind(row, binding.kind)) {
          problems.push({
            path: `sections[${sectionIndex}].widgets[${widgetIndex}].config`,
            message: `"${binding.canonicalId}" is not a ${parseKindRef(binding.kind)?.kind ?? binding.kind} on this engine`,
          });
        }
      }
    }
  }
  return problems;
}

/** Removes an instance's page and both its revisions, for instance deletion. */
export async function deleteUserPage(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const page = await userPageForInstance(ctx, instanceId);
  if (!page) {
    return;
  }
  await ctx.db.delete(page.draftRevisionId);
  if (page.publishedRevisionId) {
    await ctx.db.delete(page.publishedRevisionId);
  }
  await ctx.db.delete(page._id);
}

/**
 * Why a page mutation refused, as `ConvexError.data`, so the editor can say
 * which field is wrong or that someone else saved first.
 */
export type UserPageRefusal =
  | { code: "invalid_content"; message: string; problems: PageProblem[] }
  | { code: "stale_draft"; message: string }
  | { code: "no_slug"; message: string };

export function userPageRefusal(refusal: UserPageRefusal): ConvexError<UserPageRefusal> {
  return new ConvexError(refusal);
}
