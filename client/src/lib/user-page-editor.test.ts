import { describe, expect, test } from "bun:test";
import { defaultPageContent, PAGE_WIDGET_TYPES, PAGE_WIDGETS, type PageContent } from "@shared/user-pages";
import {
  type DraftSnapshot,
  initialEditorState,
  isDirty,
  isVisibilityOption,
  moveById,
  newWidget,
  type PageEditorAction,
  type PageEditorState,
  pageEditorReducer,
  sameContent,
  VISIBILITY_OPTIONS,
  visibilityFromOption,
  visibilityLabel,
  visibilityOption,
} from "@/lib/user-page-editor";

function stateOf(content: PageContent = defaultPageContent(), revision = 0): PageEditorState {
  return initialEditorState({ revision, content });
}

function apply(state: PageEditorState, ...actions: PageEditorAction[]): PageEditorState {
  return actions.reduce(pageEditorReducer, state);
}

function withSections(...ids: string[]): PageEditorState {
  return apply(stateOf(), ...ids.map((id): PageEditorAction => ({ type: "addSection", id, region: "main" })));
}

describe("pageEditorReducer", () => {
  test("starts clean from the draft it loads", () => {
    const state = stateOf();
    expect(isDirty(state)).toBe(false);
    expect(state.base.revision).toBe(0);
  });

  test("an edit makes it dirty and leaves the base alone", () => {
    const state = apply(stateOf(), { type: "setAccent", accent: "teal" });
    expect(isDirty(state)).toBe(true);
    expect(state.content.theme.accent).toBe("teal");
    expect(state.base.content.theme.accent).toBe("violet");
  });

  test("a new section is public, empty and in the region asked for", () => {
    const state = withSections("s1");
    expect(state.content.sections).toEqual([{ id: "s1", region: "main", visibility: { kind: "public" }, widgets: [] }]);
  });

  test("switching to a layout without a section's region moves it to the new layout's first region", () => {
    const state = apply(
      stateOf(),
      { type: "setLayout", layout: "sidebar" },
      { type: "addSection", id: "a", region: "aside" },
      { type: "addSection", id: "m", region: "main" },
      { type: "setLayout", layout: "hero-grid" }
    );
    expect(state.content.layout).toBe("hero-grid");
    expect(state.content.sections.map((section) => [section.id, section.region])).toEqual([
      ["a", "hero"],
      ["m", "hero"],
    ]);
  });

  test("switching to a layout that keeps a section's region leaves it there", () => {
    const state = apply(
      stateOf(),
      { type: "setLayout", layout: "sidebar" },
      { type: "addSection", id: "m", region: "main" },
      { type: "setLayout", layout: "single" }
    );
    expect(state.content.sections[0].region).toBe("main");
  });

  test("a blank image URL removes the image", () => {
    const set = apply(stateOf(), { type: "setImage", slot: "banner", url: "https://example.com/b.png" });
    expect(set.content.theme.banner).toEqual({ kind: "url", url: "https://example.com/b.png" });
    const cleared = apply(set, { type: "setImage", slot: "banner", url: "  " });
    expect("banner" in cleared.content.theme).toBe(false);
  });

  test("a blank section title is stored as no title", () => {
    const titled = apply(withSections("s1"), {
      type: "updateSection",
      sectionId: "s1",
      changes: { title: "Schedule" },
    });
    expect(titled.content.sections[0].title).toBe("Schedule");
    const blank = apply(titled, { type: "updateSection", sectionId: "s1", changes: { title: " " } });
    expect("title" in blank.content.sections[0]).toBe(false);
  });

  test("moves a section onto another's place", () => {
    const state = apply(withSections("a", "b", "c"), { type: "moveSection", sectionId: "c", overSectionId: "a" });
    expect(state.content.sections.map((section) => section.id)).toEqual(["c", "a", "b"]);
  });

  test("adds, replaces, moves and removes widgets within their section", () => {
    let state = apply(
      withSections("s1", "s2"),
      { type: "addWidget", sectionId: "s1", widgetType: "text", id: "w1" },
      { type: "addWidget", sectionId: "s1", widgetType: "links", id: "w2" }
    );
    expect(state.content.sections[0].widgets.map((widget) => widget.id)).toEqual(["w1", "w2"]);
    expect(state.content.sections[1].widgets).toEqual([]);

    state = apply(state, {
      type: "replaceWidget",
      sectionId: "s1",
      widget: { id: "w1", type: "text", config: { markdown: "hi" } },
    });
    expect(state.content.sections[0].widgets[0]).toEqual({ id: "w1", type: "text", config: { markdown: "hi" } });

    state = apply(state, { type: "moveWidget", sectionId: "s1", widgetId: "w2", overWidgetId: "w1" });
    expect(state.content.sections[0].widgets.map((widget) => widget.id)).toEqual(["w2", "w1"]);

    state = apply(state, { type: "removeWidget", sectionId: "s1", widgetId: "w2" });
    expect(state.content.sections[0].widgets.map((widget) => widget.id)).toEqual(["w1"]);
  });

  test("removing a section removes its widgets with it", () => {
    const state = apply(
      withSections("s1"),
      { type: "addWidget", sectionId: "s1", widgetType: "text", id: "w1" },
      { type: "removeSection", sectionId: "s1" }
    );
    expect(state.content.sections).toEqual([]);
  });

  test("a save makes the saved content the base at the new revision", () => {
    const edited = withSections("s1");
    const saved = apply(edited, { type: "saved", revision: 1, content: edited.content });
    expect(saved.base.revision).toBe(1);
    expect(isDirty(saved)).toBe(false);
  });

  test("edits made while a save was in flight stay unsaved", () => {
    const edited = withSections("s1");
    const sent = edited.content;
    const more = apply(edited, { type: "setAccent", accent: "rose" });
    const saved = apply(more, { type: "saved", revision: 1, content: sent });
    expect(saved.base.revision).toBe(1);
    expect(saved.content.theme.accent).toBe("rose");
    expect(isDirty(saved)).toBe(true);
  });
});

describe("pageEditorReducer serverDraft", () => {
  const theirs: DraftSnapshot = {
    revision: 3,
    content: { ...defaultPageContent(), theme: { accent: "amber" } },
  };

  test("adopts a newer draft when nothing is unsaved", () => {
    const state = apply(stateOf(defaultPageContent(), 2), { type: "serverDraft", draft: theirs });
    expect(state.base.revision).toBe(3);
    expect(state.content.theme.accent).toBe("amber");
    expect(state.remoteRevision).toBeNull();
  });

  test("keeps unsaved edits and notes a newer draft from someone else", () => {
    const edited = apply(stateOf(defaultPageContent(), 2), { type: "setAccent", accent: "teal" });
    const state = apply(edited, { type: "serverDraft", draft: theirs });
    expect(state.content.theme.accent).toBe("teal");
    expect(state.base.revision).toBe(2);
    expect(state.remoteRevision).toBe(3);
  });

  test("takes its own save arriving before the mutation answers as the base", () => {
    const edited = apply(stateOf(defaultPageContent(), 2), { type: "setAccent", accent: "amber" });
    const state = apply(edited, { type: "serverDraft", draft: theirs });
    expect(state.base.revision).toBe(3);
    expect(isDirty(state)).toBe(false);
    expect(state.remoteRevision).toBeNull();
  });

  test("ignores the revision it already has, and an older one", () => {
    const state = stateOf(defaultPageContent(), 3);
    expect(apply(state, { type: "serverDraft", draft: theirs })).toBe(state);
    expect(apply(state, { type: "serverDraft", draft: { ...theirs, revision: 1 } })).toBe(state);
  });

  test("load discards unsaved edits for the server's draft", () => {
    const edited = apply(
      stateOf(defaultPageContent(), 2),
      { type: "setAccent", accent: "teal" },
      {
        type: "serverDraft",
        draft: theirs,
      }
    );
    const reloaded = apply(edited, { type: "load", draft: theirs });
    expect(reloaded.content.theme.accent).toBe("amber");
    expect(reloaded.remoteRevision).toBeNull();
    expect(isDirty(reloaded)).toBe(false);
  });
});

describe("sameContent", () => {
  test("ignores key order", () => {
    const a: PageContent = { layout: "single", theme: { accent: "blue" }, sections: [] };
    const b = { sections: [], theme: { accent: "blue" }, layout: "single" } as PageContent;
    expect(sameContent(a, b)).toBe(true);
  });

  test("tells different content apart", () => {
    expect(sameContent(defaultPageContent(), { ...defaultPageContent(), layout: "sidebar" })).toBe(false);
  });
});

describe("moveById", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  test("moves down and up", () => {
    expect(moveById(items, "a", "c").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(moveById(items, "c", "b").map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  test("leaves the order alone for an unknown id", () => {
    expect(moveById(items, "x", "a").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("newWidget", () => {
  test.each(PAGE_WIDGET_TYPES)("a %s widget starts with its registry default", (type) => {
    expect(newWidget(type, "w1")).toEqual({ id: "w1", type, config: PAGE_WIDGETS[type].defaultConfig() });
  });
});

describe("visibility options", () => {
  test("every option round-trips", () => {
    for (const option of VISIBILITY_OPTIONS) {
      expect(visibilityOption(visibilityFromOption(option.value))).toBe(option.value);
    }
  });

  test("tier 1 reads as every subscriber", () => {
    expect(visibilityOption({ kind: "tier", level: 1 })).toBe("subscriber");
    expect(visibilityLabel({ kind: "tier", level: 1 })).toBe("Subscribers");
  });

  test("tiers 2 and 3 are their own options", () => {
    expect(visibilityFromOption("tier:2")).toEqual({ kind: "tier", level: 2 });
    expect(visibilityFromOption("tier:3")).toEqual({ kind: "tier", level: 3 });
  });

  test("an unknown select value is not an option", () => {
    expect(isVisibilityOption("tier:1")).toBe(false);
    expect(isVisibilityOption("moderator")).toBe(false);
    expect(isVisibilityOption("follower")).toBe(true);
  });
});
