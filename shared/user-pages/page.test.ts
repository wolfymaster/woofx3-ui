import { describe, expect, test } from "bun:test";
import { USER_PAGE_LIMITS } from "./limits";
import { checkPageContent, defaultPageContent, type PageContent, type PageSection, pageBindings } from "./page";
import { isPageWidgetType, PAGE_WIDGET_TYPES, PAGE_WIDGETS, type PageWidget } from "./widgets";

function section(widgets: PageWidget[], overrides: Partial<PageSection> = {}): PageSection {
  return { id: "s1", region: "main", visibility: { kind: "public" }, widgets, ...overrides };
}

function page(sections: PageSection[], overrides: Partial<PageContent> = {}): PageContent {
  return { ...defaultPageContent(), sections, ...overrides };
}

function onlyWidget(widget: PageWidget): PageContent {
  return page([section([widget])]);
}

const COUNTER = "woofx3:counter:deaths";
const TIMER = "woofx3:timer:break";

const valid: [string, PageContent][] = [
  ["the default page", defaultPageContent()],
  ["text", onlyWidget({ id: "w1", type: "text", config: { markdown: "# Hi" } })],
  ["a counter", onlyWidget({ id: "w1", type: "counter", config: { resource: COUNTER, showGoals: true } })],
  ["a timer with a label", onlyWidget({ id: "w1", type: "timer", config: { resource: TIMER, label: "Break" } })],
  [
    "live status",
    onlyWidget({
      id: "w1",
      type: "live-status",
      config: { showTitle: true, showGame: false, showViewerCount: true },
    }),
  ],
  [
    "http and https links",
    onlyWidget({
      id: "w1",
      type: "links",
      config: {
        links: [
          { label: "Shop", url: "https://shop.example" },
          { label: "Old", url: "http://old.example" },
        ],
      },
    }),
  ],
  [
    "an image with a link",
    onlyWidget({
      id: "w1",
      type: "image",
      config: { image: { kind: "url", url: "https://cdn.example/a.png" }, alt: "A", linkUrl: "https://x.example" },
    }),
  ],
  [
    "a form of every field type",
    onlyWidget({
      id: "w1",
      type: "form",
      config: {
        submitLabel: "Send",
        fields: [
          { id: "name", type: "text", label: "Name", required: true, maxLength: 50 },
          { id: "about", type: "textarea", label: "About", required: false, maxLength: 2000 },
          {
            id: "game",
            type: "select",
            label: "Game",
            required: true,
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
          { id: "ok", type: "checkbox", label: "Agree", required: true },
        ],
      },
    }),
  ],
  [
    "a sidebar layout using both regions",
    page(
      [
        section([], { id: "a", region: "main" }),
        section([], { id: "b", region: "aside", visibility: { kind: "tier", level: 2 } }),
      ],
      { layout: "sidebar" }
    ),
  ],
  [
    "a banner and avatar",
    page([], { theme: { accent: "teal", avatar: { kind: "url", url: "https://cdn.example/a" } } }),
  ],
];

describe("checkPageContent accepts", () => {
  test.each(valid)("%s", (_name, content) => {
    expect(checkPageContent(content)).toEqual({ ok: true, value: content });
  });
});

const tooMany = (count: number) =>
  Array.from(
    { length: count },
    (_, index): PageWidget => ({ id: `w${index}`, type: "text", config: { markdown: "" } })
  );

const invalid: [string, PageContent, string][] = [
  ["a region the layout lacks", page([section([], { region: "aside" })]), "sections[0].region"],
  ["a bad section id", page([section([], { id: "has space" })]), "sections[0].id"],
  ["a repeated section id", page([section([]), section([])]), "sections[1].id"],
  [
    "a repeated widget id across sections",
    page([
      section([{ id: "w", type: "text", config: { markdown: "" } }], { id: "a" }),
      section([{ id: "w", type: "text", config: { markdown: "" } }], { id: "b" }),
    ]),
    "sections",
  ],
  [
    "too many sections",
    page(Array.from({ length: USER_PAGE_LIMITS.sections + 1 }, (_, index) => section([], { id: `s${index}` }))),
    "sections",
  ],
  [
    "too many widgets in a section",
    page([section(tooMany(USER_PAGE_LIMITS.widgetsPerSection + 1))]),
    "sections[0].widgets",
  ],
  [
    "too many widgets on the page",
    page(
      Array.from({ length: 5 }, (_, index) =>
        section(
          tooMany(USER_PAGE_LIMITS.widgetsPerSection).map((widget) => ({ ...widget, id: `${index}-${widget.id}` })),
          { id: `s${index}` }
        )
      )
    ),
    "sections",
  ],
  [
    "text over the limit",
    onlyWidget({ id: "w1", type: "text", config: { markdown: "x".repeat(USER_PAGE_LIMITS.textLength + 1) } }),
    "sections[0].widgets[0].config.markdown",
  ],
  [
    "an unbound counter",
    onlyWidget({ id: "w1", type: "counter", config: { resource: "", showGoals: false } }),
    "sections[0].widgets[0].config.resource",
  ],
  [
    "a javascript: link",
    onlyWidget({ id: "w1", type: "links", config: { links: [{ label: "x", url: "javascript:alert(1)" }] } }),
    "sections[0].widgets[0].config.links[0].url",
  ],
  [
    "a link with no label",
    onlyWidget({ id: "w1", type: "links", config: { links: [{ label: " ", url: "https://x.example" }] } }),
    "sections[0].widgets[0].config.links[0].label",
  ],
  [
    "an http image",
    onlyWidget({ id: "w1", type: "image", config: { image: { kind: "url", url: "http://x.example/a.png" }, alt: "" } }),
    "sections[0].widgets[0].config.image.url",
  ],
  [
    "a banner that is not a URL",
    page([], { theme: { accent: "violet", banner: { kind: "url", url: "not a url" } } }),
    "theme.banner.url",
  ],
  [
    "a text answer longer than the ceiling",
    onlyWidget({
      id: "w1",
      type: "form",
      config: {
        submitLabel: "Send",
        fields: [
          { id: "f", type: "text", label: "Q", required: false, maxLength: USER_PAGE_LIMITS.formTextAnswerLength + 1 },
        ],
      },
    }),
    "sections[0].widgets[0].config.fields[0].maxLength",
  ],
  [
    "a select with no options",
    onlyWidget({
      id: "w1",
      type: "form",
      config: { submitLabel: "Send", fields: [{ id: "f", type: "select", label: "Q", required: false, options: [] }] },
    }),
    "sections[0].widgets[0].config.fields[0].options",
  ],
  [
    "repeated form field ids",
    onlyWidget({
      id: "w1",
      type: "form",
      config: {
        submitLabel: "Send",
        fields: [
          { id: "f", type: "checkbox", label: "A", required: false },
          { id: "f", type: "checkbox", label: "B", required: false },
        ],
      },
    }),
    "sections[0].widgets[0].config.fields[1].id",
  ],
  [
    "a form with no button text",
    onlyWidget({ id: "w1", type: "form", config: { submitLabel: "", fields: [] } }),
    "sections[0].widgets[0].config.submitLabel",
  ],
];

describe("checkPageContent refuses", () => {
  test.each(invalid)("%s", (_name, content, path) => {
    const result = checkPageContent(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.map((problem) => problem.path)).toContain(path);
    }
  });
});

describe("the widget registry", () => {
  // A widget that shows a resource or an image starts without one, which the owner must pick.
  const needsChoosing: Record<string, string> = { counter: "resource", timer: "resource", image: "image.url" };

  test.each(PAGE_WIDGET_TYPES)("%s starts valid but for what its owner must choose", (type) => {
    const widget = { id: "w1", type, config: PAGE_WIDGETS[type].defaultConfig() } as PageWidget;
    const result = checkPageContent(onlyWidget(widget));
    const paths = result.ok ? [] : result.problems.map((problem) => problem.path);
    const required = needsChoosing[type];
    expect(paths).toEqual(required ? [`sections[0].widgets[0].config.${required}`] : []);
  });

  test("knows its own type ids and nothing else", () => {
    expect(isPageWidgetType("counter")).toBe(true);
    expect(isPageWidgetType("toString")).toBe(false);
    expect(isPageWidgetType("module-widget")).toBe(false);
  });
});

describe("pageBindings", () => {
  test("lists each bound resource once, by kind, in page order", () => {
    const sections = [
      section([
        { id: "a", type: "timer", config: { resource: TIMER } },
        { id: "b", type: "counter", config: { resource: COUNTER, showGoals: true } },
        { id: "c", type: "counter", config: { resource: COUNTER, showGoals: false } },
        { id: "d", type: "text", config: { markdown: "" } },
      ]),
    ];
    expect(pageBindings(sections)).toEqual([
      { canonicalId: TIMER, kind: "woofx3:timer" },
      { canonicalId: COUNTER, kind: "woofx3:counter" },
    ]);
  });

  test("keeps one id bound as two kinds twice, so the wrong one is caught", () => {
    const sections = [
      section([
        { id: "a", type: "counter", config: { resource: COUNTER, showGoals: true } },
        { id: "b", type: "timer", config: { resource: COUNTER } },
      ]),
    ];
    expect(pageBindings(sections)).toHaveLength(2);
  });
});

describe("form text and ids workflows and the engine depend on", () => {
  function problemsFor(config: Extract<PageWidget, { type: "form" }>["config"]): string[] {
    const checked = checkPageContent({
      ...defaultPageContent(),
      sections: [
        {
          id: "s",
          region: "main",
          visibility: { kind: "public" },
          widgets: [{ id: "w", type: "form", config }],
        },
      ],
    });
    return checked.ok ? [] : checked.problems.map((problem) => problem.path);
  }
  const question = (overrides: { id?: string; label?: string }) => ({
    id: "q1",
    label: "Question",
    type: "checkbox" as const,
    required: false,
    ...overrides,
  });

  test("refuses a question id of only digits", () => {
    const fieldId = "sections[0].widgets[0].config.fields[0].id";
    expect(problemsFor({ submitLabel: "Send", fields: [question({ id: "123" })] })).toEqual([fieldId]);
    expect(problemsFor({ submitLabel: "Send", fields: [question({ id: "1-2" })] })).toEqual([]);
    expect(
      problemsFor({ submitLabel: "Send", fields: [question({ id: "3f2b1c9e-7a10-4d2e-9b11-0c6f5a7d8e21" })] })
    ).toEqual([]);
  });

  test("refuses a NUL or lone surrogate in a title or question", () => {
    expect(problemsFor({ title: "a\0", submitLabel: "Send", fields: [] })).toEqual([
      "sections[0].widgets[0].config.title",
    ]);
    expect(problemsFor({ submitLabel: "Send", fields: [question({ label: "a\ud800" })] })).toEqual([
      "sections[0].widgets[0].config.fields[0].label",
    ]);
  });
});
