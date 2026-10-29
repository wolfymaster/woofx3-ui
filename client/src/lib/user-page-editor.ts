import {
  PAGE_LAYOUTS,
  PAGE_WIDGETS,
  type PageAccent,
  type PageContent,
  type PageLayout,
  type PageRegion,
  type PageSection,
  type PageWidget,
  type PageWidgetType,
  type SectionVisibility,
} from "@shared/user-pages";

/**
 * The user page editor's state: the draft as last saved (`base`) and the
 * content being edited on top of it. Saving sends `base.revision` with the
 * content, so the server can refuse when someone else saved in between.
 */
export interface PageEditorState {
  base: { revision: number; content: PageContent };
  content: PageContent;
  /**
   * The server saved a newer draft while this editor held unsaved edits. Kept
   * rather than applied, so nobody's edits vanish; the owner chooses to reload.
   */
  remoteRevision: number | null;
}

/** The draft as the server holds it, in the shape `userPages.forEditing` returns it. */
export interface DraftSnapshot {
  revision: number;
  content: PageContent;
}

export type ImageSlot = "banner" | "avatar";

export type SectionChanges = Partial<Pick<PageSection, "title" | "region" | "visibility">>;

export type PageEditorAction =
  | { type: "load"; draft: DraftSnapshot }
  | { type: "serverDraft"; draft: DraftSnapshot }
  | { type: "saved"; revision: number; content: PageContent }
  | { type: "setLayout"; layout: PageLayout }
  | { type: "setAccent"; accent: PageAccent }
  | { type: "setImage"; slot: ImageSlot; url: string }
  | { type: "addSection"; id: string; region: PageRegion }
  | { type: "removeSection"; sectionId: string }
  | { type: "updateSection"; sectionId: string; changes: SectionChanges }
  | { type: "moveSection"; sectionId: string; overSectionId: string }
  | { type: "addWidget"; sectionId: string; widgetType: PageWidgetType; id: string }
  | { type: "removeWidget"; sectionId: string; widgetId: string }
  | { type: "replaceWidget"; sectionId: string; widget: PageWidget }
  | { type: "moveWidget"; sectionId: string; widgetId: string; overWidgetId: string };

export function initialEditorState(draft: DraftSnapshot): PageEditorState {
  return { base: { revision: draft.revision, content: draft.content }, content: draft.content, remoteRevision: null };
}

export function pageEditorReducer(state: PageEditorState, action: PageEditorAction): PageEditorState {
  switch (action.type) {
    case "load":
      return initialEditorState(action.draft);
    case "serverDraft":
      return reconcileServerDraft(state, action.draft);
    case "saved":
      return {
        base: { revision: action.revision, content: action.content },
        // Edits made while the save was in flight stay; they are simply unsaved again.
        content: state.content,
        remoteRevision: null,
      };
    case "setLayout":
      return edit(state, setLayout(state.content, action.layout));
    case "setAccent":
      return edit(state, { ...state.content, theme: { ...state.content.theme, accent: action.accent } });
    case "setImage":
      return edit(state, setImage(state.content, action.slot, action.url));
    case "addSection":
      return edit(state, {
        ...state.content,
        sections: [
          ...state.content.sections,
          { id: action.id, region: action.region, visibility: { kind: "public" }, widgets: [] },
        ],
      });
    case "removeSection":
      return edit(state, {
        ...state.content,
        sections: state.content.sections.filter((section) => section.id !== action.sectionId),
      });
    case "updateSection":
      return edit(
        state,
        mapSection(state.content, action.sectionId, (section) => applySectionChanges(section, action.changes))
      );
    case "moveSection":
      return edit(state, {
        ...state.content,
        sections: moveById(state.content.sections, action.sectionId, action.overSectionId),
      });
    case "addWidget":
      return edit(
        state,
        mapSection(state.content, action.sectionId, (section) => ({
          ...section,
          widgets: [...section.widgets, newWidget(action.widgetType, action.id)],
        }))
      );
    case "removeWidget":
      return edit(
        state,
        mapSection(state.content, action.sectionId, (section) => ({
          ...section,
          widgets: section.widgets.filter((widget) => widget.id !== action.widgetId),
        }))
      );
    case "replaceWidget":
      return edit(
        state,
        mapSection(state.content, action.sectionId, (section) => ({
          ...section,
          widgets: section.widgets.map((widget) => (widget.id === action.widget.id ? action.widget : widget)),
        }))
      );
    case "moveWidget":
      return edit(
        state,
        mapSection(state.content, action.sectionId, (section) => ({
          ...section,
          widgets: moveById(section.widgets, action.widgetId, action.overWidgetId),
        }))
      );
  }
}

function edit(state: PageEditorState, content: PageContent): PageEditorState {
  return { ...state, content };
}

/**
 * Takes in a draft the server now holds. One that matches the editor's own
 * content is this editor's save arriving (perhaps before the mutation's own
 * answer), so it becomes the base. Another is adopted outright when there is
 * nothing unsaved to lose, and otherwise only noted.
 */
function reconcileServerDraft(state: PageEditorState, draft: DraftSnapshot): PageEditorState {
  if (draft.revision === state.base.revision) {
    return state.remoteRevision === null ? state : { ...state, remoteRevision: null };
  }
  if (draft.revision < state.base.revision) {
    return state;
  }
  if (sameContent(draft.content, state.content) || !isDirty(state)) {
    return initialEditorState(draft);
  }
  return { ...state, remoteRevision: draft.revision };
}

export function isDirty(state: PageEditorState): boolean {
  return !sameContent(state.base.content, state.content);
}

/** Content equality that ignores object key order, which a round trip through the server need not keep. */
export function sameContent(a: PageContent, b: PageContent): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner).sort(([left], [right]) => left.localeCompare(right)));
    }
    return inner;
  });
}

/**
 * Switches layout and moves every section whose region the new layout lacks
 * into its first region, keeping their order, so a layout change never leaves
 * a section somewhere the page cannot render it.
 */
function setLayout(content: PageContent, layout: PageLayout): PageContent {
  const regions = PAGE_LAYOUTS[layout].regions;
  const fallback = regions[0];
  return {
    ...content,
    layout,
    sections: content.sections.map((section) =>
      regions.includes(section.region) ? section : { ...section, region: fallback }
    ),
  };
}

/** An empty or blank URL removes the image; anything else is kept as typed, for the checks to judge. */
function setImage(content: PageContent, slot: ImageSlot, url: string): PageContent {
  const theme = { ...content.theme };
  if (url.trim() === "") {
    delete theme[slot];
  } else {
    theme[slot] = { kind: "url", url };
  }
  return { ...content, theme };
}

function applySectionChanges(section: PageSection, changes: SectionChanges): PageSection {
  if (!("title" in changes)) {
    return { ...section, ...changes };
  }
  const { title: _previous, ...rest } = { ...section, ...changes };
  const title = optionalText(changes.title ?? "");
  return title === undefined ? rest : { ...rest, title };
}

function mapSection(
  content: PageContent,
  sectionId: string,
  change: (section: PageSection) => PageSection
): PageContent {
  return {
    ...content,
    sections: content.sections.map((section) => (section.id === sectionId ? change(section) : section)),
  };
}

/** `items` with the one whose id is `id` moved to where `overId` is, as a sortable list drop does. */
export function moveById<Item extends { id: string }>(items: readonly Item[], id: string, overId: string): Item[] {
  const from = items.findIndex((item) => item.id === id);
  const to = items.findIndex((item) => item.id === overId);
  if (from === -1 || to === -1 || from === to) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A widget of `type` with that type's default config, from the registry. */
export function newWidget(type: PageWidgetType, id: string): PageWidget {
  // The registry's mapped type pairs each type with its own defaultConfig;
  // TypeScript cannot follow that pairing through an indexed access.
  return { id, type, config: PAGE_WIDGETS[type].defaultConfig() } as PageWidget;
}

/** An optional text field's stored value: blank is absent. */
export function optionalText(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}

export function sectionsInRegion(content: PageContent, region: PageRegion): PageSection[] {
  return content.sections.filter((section) => section.region === region);
}

/** A section's index in the whole page, which is what problem paths count by. */
export function sectionIndex(content: PageContent, sectionId: string): number {
  return content.sections.findIndex((section) => section.id === sectionId);
}

// Visibility as one select value, with each tier as its own option spelled
// `tier:<level>`. Tier 1 or higher is every subscriber, so a stored tier 1
// shows as Subscribers and the select offers no separate tier 1.

export type VisibilityOption = "public" | "signed_in" | "follower" | "subscriber" | "tier:2" | "tier:3";

export const VISIBILITY_OPTIONS: readonly { value: VisibilityOption; label: string }[] = [
  { value: "public", label: "Everyone" },
  { value: "signed_in", label: "Signed-in viewers" },
  { value: "follower", label: "Followers" },
  { value: "subscriber", label: "Subscribers" },
  { value: "tier:2", label: "Tier 2 subscribers and up" },
  { value: "tier:3", label: "Tier 3 subscribers" },
];

export function visibilityOption(visibility: SectionVisibility): VisibilityOption {
  if (visibility.kind !== "tier") {
    return visibility.kind;
  }
  switch (visibility.level) {
    case 1:
      return "subscriber";
    case 2:
      return "tier:2";
    case 3:
      return "tier:3";
  }
}

export function visibilityFromOption(option: VisibilityOption): SectionVisibility {
  switch (option) {
    case "public":
    case "signed_in":
    case "follower":
    case "subscriber":
      return { kind: option };
    case "tier:2":
      return { kind: "tier", level: 2 };
    case "tier:3":
      return { kind: "tier", level: 3 };
  }
}

export function isVisibilityOption(value: string): value is VisibilityOption {
  return VISIBILITY_OPTIONS.some((option) => option.value === value);
}

export function visibilityLabel(visibility: SectionVisibility): string {
  const option = visibilityOption(visibility);
  const entry = VISIBILITY_OPTIONS.find((candidate) => candidate.value === option);
  if (!entry) {
    throw new Error(`No visibility option for ${option}`);
  }
  return entry.label;
}

export const REGION_LABELS: Record<PageRegion, string> = {
  main: "Main column",
  aside: "Sidebar",
  hero: "Hero",
  grid: "Grid",
};
