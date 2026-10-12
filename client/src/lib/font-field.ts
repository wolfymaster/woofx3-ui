import type { GoogleFontFamily } from "@woofx3/api/google-fonts";

/** How many families the picker lists at once; the catalog is in popularity order, so these are the likeliest. */
export const FONT_PICKER_LIMIT = 60;

/** The families matching `query` (any part of the name, any case), most popular first. */
export function matchFontFamilies(
  families: readonly GoogleFontFamily[],
  query: string,
  limit = FONT_PICKER_LIMIT
): GoogleFontFamily[] {
  const needle = query.trim().toLowerCase();
  const matches: GoogleFontFamily[] = [];
  for (const entry of families) {
    if (needle === "" || entry.family.toLowerCase().includes(needle)) {
      matches.push(entry);
      if (matches.length === limit) {
        break;
      }
    }
  }
  return matches;
}

/**
 * A stylesheet showing each family's name in that family, for previews in
 * the picker. `text=` limits it to the letters of the names, so a page of
 * previews downloads a few KB rather than whole fonts.
 */
export function fontPreviewStylesheetUrl(families: readonly string[]): string | null {
  if (families.length === 0) {
    return null;
  }
  const query = new URLSearchParams();
  for (const family of families) {
    query.append("family", family);
  }
  const letters = [...new Set(families.join(""))].sort().join("");
  query.set("text", letters);
  query.set("display", "swap");
  return `https://fonts.googleapis.com/css2?${query}`;
}
