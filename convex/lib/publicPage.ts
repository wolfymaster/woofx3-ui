import type {
  PageContent,
  PageSection,
  PageWidget,
  PageWidgetConfig,
  PublicLiveStatus,
  PublicPageLookup,
  PublicPageSection,
  PublicPageWidget,
  PublicResourceState,
  SectionRequirement,
} from "@shared/user-pages";
import type { Doc } from "../_generated/dataModel";
import { gatedOnRoles, type PageViewer, type SectionAccess, sectionAccess } from "./sectionAccess";
import { viewerRolesRenewAt } from "./viewerAuth";

/** What a published page's widgets read besides their own config. */
export interface PublicPageSources {
  /** Projected values by canonical id: userPageState rows. */
  states: ReadonlyMap<string, PublicResourceState>;
  /** The instance's live state, or null when it has none. */
  live: Pick<Doc<"instanceLiveState">, "isLive" | "streamTitle" | "gameName" | "viewerCount"> | null;
}

/** Only the facts the widget is set to show; nothing at all about the stream while it is offline. */
function toPublicLiveStatus(
  config: PageWidgetConfig<"live-status">,
  live: PublicPageSources["live"]
): PublicLiveStatus {
  if (!live?.isLive) {
    return { isLive: false };
  }
  return {
    isLive: true,
    ...(config.showTitle && live.streamTitle !== undefined ? { title: live.streamTitle } : {}),
    ...(config.showGame && live.gameName !== undefined ? { game: live.gameName } : {}),
    ...(config.showViewerCount && live.viewerCount !== undefined ? { viewerCount: live.viewerCount } : {}),
  };
}

function toPublicWidget(widget: PageWidget, sources: PublicPageSources): PublicPageWidget {
  switch (widget.type) {
    case "counter": {
      const { resource, ...config } = widget.config;
      return { id: widget.id, type: "counter", config, state: sources.states.get(resource) ?? null };
    }
    case "timer": {
      const { resource, ...config } = widget.config;
      return { id: widget.id, type: "timer", config, state: sources.states.get(resource) ?? null };
    }
    case "live-status":
      return { ...widget, live: toPublicLiveStatus(widget.config, sources.live) };
    case "text":
    case "links":
    case "image":
    case "form":
      return widget;
  }
}

/** Each section of `content` with whether `viewer` may see it, in page order. */
export function sectionsForViewer(
  content: PageContent,
  viewer: PageViewer
): { section: PageSection; access: SectionAccess }[] {
  return content.sections.map((section) => ({ section, access: sectionAccess(section.visibility, viewer) }));
}

/** The sections `viewer` may see, the only ones whose bindings and live facts the read loads. */
export function openSections(content: PageContent, viewer: PageViewer): PageSection[] {
  return sectionsForViewer(content, viewer)
    .filter(({ access }) => access.kind === "open")
    .map(({ section }) => section);
}

function requirementOf(section: PageSection): SectionRequirement {
  if (section.visibility.kind === "public") {
    throw new Error(`public section ${section.id} cannot be locked`);
  }
  return section.visibility;
}

/**
 * The published content as `viewer` may see it, every binding replaced by its
 * value. A section the viewer may not see keeps its place as a locked
 * placeholder carrying only its region and requirement.
 */
export function toPublicPage(
  slug: string,
  content: PageContent,
  publishedAt: number,
  viewer: PageViewer,
  sources: PublicPageSources
): Extract<PublicPageLookup, { kind: "page" }> {
  const decided = sectionsForViewer(content, viewer);
  const sections: PublicPageSection[] = decided.map(({ section, access }) =>
    access.kind === "open"
      ? {
          kind: "open",
          id: section.id,
          region: section.region,
          ...(section.title !== undefined ? { title: section.title } : {}),
          widgets: section.widgets.map((widget) => toPublicWidget(widget, sources)),
        }
      : { kind: "locked", region: section.region, requirement: requirementOf(section), reason: access.reason }
  );
  const rolesStale = decided.some(({ access }) => access.kind === "locked" && access.reason === "roles_unknown");
  const usesRoles = content.sections.some((section) => gatedOnRoles(section.visibility));
  const rolesRenewAt =
    usesRoles && viewer.kind === "signed_in" && viewer.roles.kind === "known"
      ? viewerRolesRenewAt(viewer.roles.checkedAt)
      : null;
  return {
    kind: "page",
    slug,
    layout: content.layout,
    theme: content.theme,
    sections,
    rolesStale,
    rolesRenewAt,
    publishedAt,
  };
}
