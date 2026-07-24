export const CONVEX_SITE_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  (import.meta.env.VITE_CONVEX_URL as string).replace(/\.convex\.cloud$/, ".convex.site");
