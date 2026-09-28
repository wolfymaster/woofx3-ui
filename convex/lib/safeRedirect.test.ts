import { describe, expect, test } from "bun:test";
import { safeRelativePath, withQuery } from "./safeRedirect";

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
      "http://evil.example/",
      "//evil.example",
      "///evil.example",
      "////evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "\\/evil.example",
      "/\t/evil.example",
      "/\r/evil.example",
      "/\n/evil.example",
      "/\u0000/evil.example",
      "/\x7f/evil.example",
      "%2F%2Fevil.example",
      "%5C%5Cevil.example",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "evil.example/path",
      "@evil.example",
      "user:pass@evil.example",
      "\uff0f\uff0fevil.example",
      "\u2215\u2215evil.example",
      "/..//evil.example",
      "/.//evil.example",
      "/foo/..//evil.example",
      "/foo/../..//evil.example",
      "/%2e%2e//evil.example",
      "/%2E%2E//evil.example",
      "/%2e//evil.example",
      "/.%2e//evil.example",
      "/foo/%2e%2e//evil.example",
      "/./..//evil.example?x=1#y",
    ]) {
      expect({ hostile, result: safeRelativePath(hostile) }).toEqual({ hostile, result: "/" });
    }
  });

  test("keeps encoded slashes and unicode slashes inside a path, where they name no host", () => {
    for (const [input, expected] of [
      ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
      ["/%5C%5Cevil.example", "/%5C%5Cevil.example"],
      ["/@evil.example", "/@evil.example"],
      ["/\uff0f\uff0fevil.example", "/%EF%BC%8F%EF%BC%8Fevil.example"],
      ["/\u2215evil.example", "/%E2%88%95evil.example"],
    ]) {
      const result = safeRelativePath(input);
      expect({ input, result }).toEqual({ input, result: expected });
      expect(new URL(result, "https://site.example").origin).toBe("https://site.example");
    }
  });

  test("collapses dot segments that stay on this site", () => {
    expect(safeRelativePath("/foo/../admin")).toBe("/admin");
    expect(safeRelativePath("/./admin")).toBe("/admin");
    expect(safeRelativePath("/%2e%2e/admin")).toBe("/admin");
  });

  test("every result resolves to this site and never starts with two slashes", () => {
    const inputs = ["/..//a", "/.//a", "/a/..//b", "/%2e%2e//c", "/a b", "/ok?next=//evil.example"];
    for (const input of inputs) {
      const result = safeRelativePath(input);
      expect(result.startsWith("//")).toBe(false);
      expect(new URL(result, "https://site.example").origin).toBe("https://site.example");
    }
  });

  test("rejects a fallback that is not itself site-relative", () => {
    expect(() => safeRelativePath("/x", "https://evil.example")).toThrow();
    expect(() => safeRelativePath("/x", "//evil.example")).toThrow();
  });
});

describe("withQuery", () => {
  test("adds parameters to a bare path", () => {
    expect(withQuery("/modules/abc", { integration: "spotify", status: "connected" })).toBe(
      "/modules/abc?integration=spotify&status=connected"
    );
  });

  test("keeps the path's own query and hash", () => {
    expect(withQuery("/modules?category=music#top", { status: "error" })).toBe(
      "/modules?category=music&status=error#top"
    );
  });

  test("encodes values", () => {
    expect(withQuery("/modules", { message: "a & b?" })).toBe("/modules?message=a+%26+b%3F");
  });

  test("clamps a hostile path to the fallback before adding anything", () => {
    expect(withQuery("//evil.example", { status: "error" }, "/modules")).toBe("/modules?status=error");
  });
});
