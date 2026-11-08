/**
 * The one vertical rail style in the app. Both the section subnav and the
 * per-page list sidebars (modules, scenes, workflows, widget catalog) use it so
 * the rail keeps the same width and surface on every page, whether or not the
 * page has a subnav.
 */
export const SIDEBAR_RAIL = "w-64 shrink-0 border-r border-border bg-card flex flex-col";

/**
 * A page's own list rail: a column beside the content from tablet width up, and the whole
 * page on a phone until something is picked from it. `ListDetail` lays it out.
 */
export const LIST_RAIL = "w-full shrink-0 bg-card flex flex-col md:w-64 md:border-r md:border-border";
