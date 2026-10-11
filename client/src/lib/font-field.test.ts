import { describe, expect, it } from "bun:test";
import type { GoogleFontFamily } from "@woofx3/api/google-fonts";
import { fontPreviewStylesheetUrl, matchFontFamilies } from "./font-field";

const FAMILIES: GoogleFontFamily[] = [
  { family: "Roboto", category: "sans-serif" },
  { family: "Open Sans", category: "sans-serif" },
  { family: "Roboto Slab", category: "serif" },
  { family: "Lobster", category: "display" },
];

describe("matchFontFamilies", () => {
  it("keeps catalog order and matches any part of the name, any case", () => {
    expect(matchFontFamilies(FAMILIES, "robo").map((f) => f.family)).toEqual(["Roboto", "Roboto Slab"]);
    expect(matchFontFamilies(FAMILIES, "  SLAB ").map((f) => f.family)).toEqual(["Roboto Slab"]);
  });

  it("lists the first families up to the limit when nothing is typed", () => {
    expect(matchFontFamilies(FAMILIES, "", 2).map((f) => f.family)).toEqual(["Roboto", "Open Sans"]);
  });
});

describe("fontPreviewStylesheetUrl", () => {
  it("asks for every family in one request, limited to the letters of their names", () => {
    const href = fontPreviewStylesheetUrl(["Lobster", "Open Sans"]);
    expect(href).not.toBeNull();
    const url = new URL(href ?? "");
    expect(url.origin).toBe("https://fonts.googleapis.com");
    expect(url.searchParams.getAll("family")).toEqual(["Lobster", "Open Sans"]);
    expect(url.searchParams.get("text")).toBe(" LOSabenoprst");
  });

  it("asks for nothing when there is nothing to preview", () => {
    expect(fontPreviewStylesheetUrl([])).toBeNull();
  });
});
