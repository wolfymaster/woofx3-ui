import {
  type PageContent,
  type PageSection,
  type PageWidget,
  type PageWidgetConfig,
  type PublicLiveStatus,
  type PublicPageLookup,
  type PublicPageSection,
  type PublicPageWidget,
  type PublicResourceState,
  parseFormDefinition,
  parsePublicDatabaseColumns,
  type SectionRequirement,
  USER_PAGE_LIMITS,
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
  /** Whether this page's forms can take an answer from this viewer right now. */
  formsAccepting: boolean;
  /** The projected rows of each bound database, by canonical id. */
  databaseRows: ReadonlyMap<string, readonly Pick<Doc<"userPageDatabaseRecords">, "values" | "createdAt">[]>;
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
    case "form":
      return {
        id: widget.id,
        type: "form",
        form: parseFormDefinition(sources.states.get(widget.config.resource)?.settings),
        accepting: sources.formsAccepting,
      };
    case "database":
      return toPublicDatabase(widget.id, widget.config, sources);
    case "text":
    case "links":
    case "image":
      return widget;
  }
}

type Cell = string | number | boolean | null;

/**
 * Orders cells of one column: empty cells last, numbers by value, text and
 * dates (`YYYY-MM-DD`) by code unit so the order is the same everywhere, and
 * false before true.
 */
export function compareCells(a: Cell, b: Cell): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A database widget as visitors see it: only columns the widget chose that
 * are public now, even if the projection still holds a column made private
 * a moment ago, and only for a database the published page binds (its state
 * row exists only then).
 */
function toPublicDatabase(
  id: string,
  config: PageWidgetConfig<"database">,
  sources: PublicPageSources
): PublicPageWidget {
  const label = config.label ?? null;
  const state = sources.states.get(config.resource);
  if (!state) {
    return { id, type: "database", label, columns: [], rows: [] };
  }
  const publicColumns = parsePublicDatabaseColumns(state.settings);
  const columns = config.columns.flatMap((columnId) => publicColumns.find((column) => column.id === columnId) ?? []);
  const rows = (sources.databaseRows.get(config.resource) ?? []).map((row) => {
    const cells = new Map(row.values.map((cell) => [cell.columnId, cell.value]));
    return { createdAt: row.createdAt, cells: columns.map((column): Cell => cells.get(column.id) ?? null) };
  });
  const sortIndex = columns.findIndex((column) => column.id === config.sortBy);
  const sign = config.direction === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const order =
      sortIndex === -1
        ? a.createdAt - b.createdAt
        : compareCells(a.cells[sortIndex] ?? null, b.cells[sortIndex] ?? null);
    // Empty cells stay last whichever way the column sorts.
    if (sortIndex !== -1 && (a.cells[sortIndex] === null) !== (b.cells[sortIndex] === null)) {
      return order;
    }
    return sign * order;
  });
  const limit = Math.min(Math.max(Math.trunc(config.limit), 1), USER_PAGE_LIMITS.databaseWidgetRows);
  return { id, type: "database", label, columns, rows: rows.slice(0, limit).map((row) => row.cells) };
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
