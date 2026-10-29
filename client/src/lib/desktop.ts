/**
 * Whether this is the dashboard the woofx3 desktop app shows. The `typeof`
 * guard keeps code that runs outside Vite (tests) on the web path, where the
 * build constant is not defined.
 */
export const IS_DESKTOP: boolean = typeof __WOOFX3_DESKTOP__ !== "undefined" && __WOOFX3_DESKTOP__;
