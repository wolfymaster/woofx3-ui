import type { PageContent, PageSection, SectionVisibility } from "./page";
import type { BindableResourceKind, PageWidget, PageWidgetConfig } from "./widgets";

/**
 * A published page as a visitor receives it. Bindings are replaced by the
 * values they show, so no canonical id, instance id or account id leaves
 * Convex, and only sections this viewer may see carry their content.
 */

/**
 * A bound resource's current value as the engine stores it (null before it is
 * first written), and only the settings needed to read it: what
 * `counterValue`, `counterGoals` and `timerState` in
 * client/src/lib/resource-values.ts take. Timers are passed through as
 * `{ running: true, endsAt }` or `{ running: false, remainingMs }`, so the
 * viewer's browser counts down without Convex writing every second.
 */
export interface PublicResourceState {
  kind: BindableResourceKind;
  value: unknown;
  settings: Record<string, unknown>;
}

/** Live-stream facts, each present only when the widget shows it. */
export interface PublicLiveStatus {
  isLive: boolean;
  title?: string;
  game?: string;
  viewerCount?: number;
}

export type PublicPageWidget =
  | Extract<PageWidget, { type: "text" | "links" | "image" | "form" }>
  | {
      id: string;
      type: "counter";
      config: Omit<PageWidgetConfig<"counter">, "resource">;
      /** Null when Convex holds no value for it yet. */
      state: PublicResourceState | null;
    }
  | {
      id: string;
      type: "timer";
      config: Omit<PageWidgetConfig<"timer">, "resource">;
      state: PublicResourceState | null;
    }
  | { id: string; type: "live-status"; config: PageWidgetConfig<"live-status">; live: PublicLiveStatus };

/** Who a section that is not public is for. */
export type SectionRequirement = Exclude<SectionVisibility, { kind: "public" }>;

/**
 * Why a section is locked for this viewer:
 * - `sign_in`: nobody is signed in, or the session has ended.
 * - `roles_unknown`: signed in, but the viewer's roles on the channel are
 *   missing or expired; `viewerRoles.refresh` can find out.
 * - `not_eligible`: the viewer's current roles do not meet the requirement.
 * - `unverifiable`: roles cannot be checked on this page at all (the
 *   streamer's channel is not linked, or is on another platform).
 */
export type LockedSectionReason = "sign_in" | "roles_unknown" | "not_eligible" | "unverifiable";

/**
 * A section as this viewer receives it. A locked one says only where it sits
 * and who it is for: no id, title or widget, since an owner may name a
 * section after what it hides.
 */
export type PublicPageSection =
  | {
      kind: "open";
      id: string;
      region: PageSection["region"];
      title?: string;
      widgets: PublicPageWidget[];
    }
  | {
      kind: "locked";
      region: PageSection["region"];
      requirement: SectionRequirement;
      reason: LockedSectionReason;
    };

/**
 * What `userPagesPublic.bySlug` answers:
 * - `page`: the published page as this viewer may see it. `rolesStale` is
 *   true when some section is locked only because the viewer's roles are
 *   missing or expired (`roles_unknown`), so a role refresh could open it.
 *   `rolesRenewAt` (milliseconds since the epoch) is when the viewer's
 *   current roles should be refreshed so they are replaced before they
 *   expire; null when no role check is in use (anonymous, no roles yet, or
 *   no section gated on roles).
 * - `unavailable`: an engine holds the name, but nothing is published there
 *   (never published, taken offline, or the plan no longer includes pages).
 * - `unclaimed`: no engine holds the name. Whether it can still be claimed is
 *   `userPagesPublic.claimable`'s question, since the reserved names live in
 *   the maintenance API.
 */
export type PublicPageLookup =
  | {
      kind: "page";
      slug: string;
      layout: PageContent["layout"];
      theme: PageContent["theme"];
      sections: PublicPageSection[];
      rolesStale: boolean;
      rolesRenewAt: number | null;
      publishedAt: number;
    }
  | { kind: "unavailable" }
  | { kind: "unclaimed" };
