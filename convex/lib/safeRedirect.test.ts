import { describe, expect, test } from "bun:test";
import { safeRelativePath } from "./safeRedirect";

describe("safeRelativePath", () => {
  test("keeps a path on this site, query and hash included", () => {
    expect(safeRelativePath("/admin/integrations")).toBe("/admin/integrations");
    expect(safeRelativePath("/settings?tab=integrations#twitch")).toBe("/settings?tab=integrations#twitch");
  });

  test("falls back for a missing value", () => {
    expect(safeRelativePath(null)).toBe("/");
    expect(safeRelativePath(undefined, "/admin")).toBe("/admin");
    expect(safeRelativePath("")).toBe("/");
  });

  test("refuses anything that can name another origin", () => {
    for (const hostile of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "javascript:alert(1)",
      "evil.example/path",
      "@evil.example",
    ]) {
      expect({ hostile, result: safeRelativePath(hostile) }).toEqual({ hostile, result: "/" });
    }
  });

  test("rejects a fallback that is not itself site-relative", () => {
    expect(() => safeRelativePath("/x", "https://evil.example")).toThrow();
    expect(() => safeRelativePath("/x", "//evil.example")).toThrow();
  });
});
