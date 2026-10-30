import { parseKindRef } from "@shared/resource-kinds";
import { type PageContent, type PageProblem, type ResourceBinding, widgetBindings } from "@shared/user-pages";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { accountEntitlements } from "./entitlementAccess";
import { normalizeSlug } from "./maintenanceClient";
import { rebuildPageState } from "./userPageState";

/** Provisioning states in which the maintenance API no longer holds the engine's slug for it. */
const SLUG_RELEASED_STATUSES: ReadonlySet<Doc<"engineProvisioning">["status"]> = new Set(["deprovisioning", "deleted"]);

/**
 * Whether the row's engine holds its slug: once the maintenance API has
 * allocated it (`maintenanceEngineId` is set when it answers) and until the
 * engine is torn down.
 */
function holdsSlug(provisioning: Doc<"engineProvisioning">): boolean {
  return provisioning.maintenanceEngineId !== undefined && !SLUG_RELEASED_STATUSES.has(provisioning.status);
}

/**
 * The name a page is published under: its managed engine's slug. Null for
 * every other instance, which has no name to publish under.
 */
export async function pageSlugForInstance(ctx: QueryCtx, instanceId: Id<"instances">): Promise<string | null> {
  const provisioning = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  return provisioning && holdsSlug(provisioning) ? provisioning.slug : null;
}

/**
 * Released slugs stay on their provisioning rows, and the maintenance API
 * reissues one only after its engine is gone, so a slug matches a handful of
 * rows at most, of which one at most holds it.
 */
const MAX_ROWS_PER_SLUG = 20;

/** The instance whose engine holds `slug` (lowercase, as stored), or null when none does. */
export async function instanceHoldingSlug(ctx: QueryCtx, slug: string): Promise<Id<"instances"> | null> {
  const rows = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .take(MAX_ROWS_PER_SLUG);
  const holders = rows.filter(holdsSlug);
  if (holders.length > 1) {
    throw new Error(`Slug "${slug}" is held by ${holders.length} engines`);
  }
  return holders[0]?.instanceId ?? null;
}

/** Longer than any slug the maintenance API issues, so a longer one is answered without a read. */
const MAX_SLUG_LENGTH = 63;

/**
 * The instance whose page a visitor names at `/u/<slug>`, in any case and
 * with stray whitespace, together with the slug as stored. Null when no
 * engine holds it.
 */
export async function instanceForPageSlug(
  ctx: QueryCtx,
  requested: string
): Promise<{ slug: string; instanceId: Id<"instances"> } | null> {
  const slug = normalizeSlug(requested);
  if (slug === "" || slug.length > MAX_SLUG_LENGTH) {
    return null;
  }
  const instanceId = await instanceHoldingSlug(ctx, slug);
  return instanceId === null ? null : { slug, instanceId };
}

/**
 * Whether an instance may have a live page. Every hosted plan includes pages,
 * so a managed engine always may; any other engine (self-hosted, or a local
 * one linked to an account) needs the account's `userPages` feature, the
 * paid subscription. Publishing and the public read both ask this, so a page
 * whose account loses the feature goes offline without being unpublished.
 */
export function userPagesAllowed(hosting: Doc<"instances">["hosting"], features: readonly string[]): boolean {
  return hosting === "managed" || features.includes("userPages");
}

export async function instanceAllowsUserPages(ctx: QueryCtx, instance: Doc<"instances">): Promise<boolean> {
  // Hosting alone decides for a managed engine, so its plan is not read.
  if (userPagesAllowed(instance.hosting, [])) {
    return true;
  }
  return userPagesAllowed(instance.hosting, (await accountEntitlements(ctx, instance.accountId)).features);
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

/** Removes an instance's page, both its revisions and its published values, for instance deletion. */
export async function deleteUserPage(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  await rebuildPageState(ctx, instanceId, null);
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
  | { code: "no_slug"; message: string }
  | { code: "not_entitled"; message: string };

export function userPageRefusal(refusal: UserPageRefusal): ConvexError<UserPageRefusal> {
  return new ConvexError(refusal);
}
