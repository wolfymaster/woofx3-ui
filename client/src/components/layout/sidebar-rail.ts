/**
 * The one vertical rail style in the app. Both the section subnav and the
 * per-page list sidebars (modules, scenes, workflows, widget catalog) use it so
 * the rail keeps the same width and surface on every page, whether or not the
 * page has a subnav.
 */
export const SIDEBAR_RAIL = "w-64 shrink-0 border-r border-border bg-card flex flex-col";

/**
 * A page's own list rail: beside the content from tablet width up, above it on a phone,
 * where a 16rem column beside the section rail leaves the content no room. Its parent
 * uses `LIST_RAIL_FRAME`.
 */
export const LIST_RAIL =
  "w-full max-h-[40vh] shrink-0 border-b border-border bg-card flex flex-col md:w-64 md:max-h-none md:border-b-0 md:border-r";

/** The page frame around a `LIST_RAIL` and the content beside it. */
export const LIST_RAIL_FRAME = "flex h-full w-full flex-col overflow-hidden md:flex-row";
