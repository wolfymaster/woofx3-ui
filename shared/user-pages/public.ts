import type { PageContent, PageSection } from "./page";
import type { BindableResourceKind, PageWidget, PageWidgetConfig } from "./widgets";

/**
 * A published page as a visitor receives it. Bindings are replaced by the
 * values they show, so no canonical id, instance id or account id leaves
 * Convex, and only sections every visitor may see are included.
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

export interface PublicPageSection {
  id: string;
  region: PageSection["region"];
  title?: string;
  widgets: PublicPageWidget[];
}

/**
 * What `userPagesPublic.bySlug` answers:
 * - `page`: the published page.
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
      publishedAt: number;
    }
  | { kind: "unavailable" }
  | { kind: "unclaimed" };
