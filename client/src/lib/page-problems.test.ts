import { describe, expect, test } from "bun:test";
import { checkPageContent, type PageContent } from "@shared/user-pages";
import { fieldPath, isWithinPath, itemPath, ProblemIndex } from "@/lib/page-problems";

describe("isWithinPath", () => {
  test.each([
    ["sections[1]", "sections[1]", true],
    ["sections[1].title", "sections[1]", true],
    ["sections[1].widgets[0]", "sections[1].widgets", true],
    ["sections[10]", "sections[1]", false],
    ["sections[1]x", "sections[1]", false],
    ["theme.banner.url", "", true],
  ])("%s within %s is %p", (path, parent, expected) => {
    expect(isWithinPath(path, parent)).toBe(expected);
  });
});

describe("ProblemIndex", () => {
  const index = new ProblemIndex([
    { path: "sections[0].title", message: "Too long" },
    { path: "sections[0].widgets[1].config.links[0].url", message: "Not a valid URL" },
    { path: "sections[0].widgets[1].config.links[0].url", message: "Second" },
    { path: "sections[1].id", message: "Bad id" },
  ]);

  test("finds the messages at an exact path", () => {
    expect(index.at("sections[0].widgets[1].config.links[0].url")).toEqual(["Not a valid URL", "Second"]);
    expect(index.at("sections[0]")).toEqual([]);
  });

  test("counts everything below a path", () => {
    expect(index.countUnder("sections[0]")).toBe(3);
    expect(index.countUnder("sections[0].widgets[1]")).toBe(2);
    expect(index.countUnder("sections[1]")).toBe(1);
    expect(index.size).toBe(4);
  });
});

/**
 * The editor builds each field's path itself; these hold it to the paths the
 * shared checks (and so the server) report, so a problem lands on its field.
 */
describe("editor paths match the shared checks", () => {
  function problemPaths(content: PageContent): string[] {
    const result = checkPageContent(content);
    return result.ok ? [] : result.problems.map((problem) => problem.path);
  }

  const widgets = itemPath(fieldPath(itemPath("sections", 0), "widgets"), 0);

  test("a link's address", () => {
    const content: PageContent = {
      layout: "single",
      theme: { accent: "violet" },
      sections: [
        {
          id: "s1",
          region: "main",
          visibility: { kind: "public" },
          widgets: [{ id: "w1", type: "links", config: { links: [{ label: "Site", url: "javascript:alert(1)" }] } }],
        },
      ],
    };
    expect(problemPaths(content)).toEqual([
      fieldPath(itemPath(fieldPath(fieldPath(widgets, "config"), "links"), 0), "url"),
    ]);
  });

  test("an unbound counter", () => {
    const content: PageContent = {
      layout: "single",
      theme: { accent: "violet" },
      sections: [
        {
          id: "s1",
          region: "main",
          visibility: { kind: "public" },
          widgets: [{ id: "w1", type: "counter", config: { resource: "", showGoals: true } }],
        },
      ],
    };
    expect(problemPaths(content)).toEqual([fieldPath(fieldPath(widgets, "config"), "resource")]);
  });

  test("an insecure banner and an image widget's picture", () => {
    const content: PageContent = {
      layout: "single",
      theme: { accent: "violet", banner: { kind: "url", url: "http://example.com/b.png" } },
      sections: [
        {
          id: "s1",
          region: "main",
          visibility: { kind: "public" },
          widgets: [{ id: "w1", type: "image", config: { image: { kind: "url", url: "" }, alt: "" } }],
        },
      ],
    };
    expect(problemPaths(content)).toEqual([
      "theme.banner.url",
      fieldPath(fieldPath(fieldPath(widgets, "config"), "image"), "url"),
    ]);
  });

  test("a section in a region its layout lacks", () => {
    const content: PageContent = {
      layout: "single",
      theme: { accent: "violet" },
      sections: [{ id: "s1", region: "aside", visibility: { kind: "public" }, widgets: [] }],
    };
    expect(problemPaths(content)).toEqual([fieldPath(itemPath("sections", 0), "region")]);
  });
});
