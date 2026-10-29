import {
  isPublicSection,
  type PageContent,
  type PageWidget,
  type PageWidgetConfig,
  type PublicLiveStatus,
  type PublicPageLookup,
  type PublicPageSection,
  type PublicPageWidget,
  type PublicResourceState,
} from "@shared/user-pages";
import type { Doc } from "../_generated/dataModel";

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

/**
 * The published content as a visitor may see it: public sections only, until
 * the read knows who the viewer is, and every binding replaced by its value.
 */
export function toPublicPage(
  slug: string,
  content: PageContent,
  publishedAt: number,
  sources: PublicPageSources
): Extract<PublicPageLookup, { kind: "page" }> {
  const sections: PublicPageSection[] = content.sections.filter(isPublicSection).map((section) => ({
    id: section.id,
    region: section.region,
    ...(section.title !== undefined ? { title: section.title } : {}),
    widgets: section.widgets.map((widget) => toPublicWidget(widget, sources)),
  }));
  return { kind: "page", slug, layout: content.layout, theme: content.theme, sections, publishedAt };
}
