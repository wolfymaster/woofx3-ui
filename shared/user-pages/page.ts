import { type Infer, v } from "convex/values";
import { checkId, checkImage, checkUniqueIds, pageImageValidator } from "./fields";
import { USER_PAGE_LIMITS } from "./limits";
import { checked, type PageCheck, type PageProblem, ProblemReport } from "./problems";
import { checkWidget, pageWidgetValidator, type ResourceBinding, widgetBindings } from "./widgets";

/**
 * A user page's content: one of a few fixed layouts, an accent from a preset
 * list, and ordered sections of widgets. Customization stops there on
 * purpose, so every page renders well without the owner designing it.
 */

export const pageLayoutValidator = v.union(v.literal("single"), v.literal("sidebar"), v.literal("hero-grid"));
export type PageLayout = Infer<typeof pageLayoutValidator>;

export const pageRegionValidator = v.union(v.literal("main"), v.literal("aside"), v.literal("hero"), v.literal("grid"));
export type PageRegion = Infer<typeof pageRegionValidator>;

/** The regions each layout has, in the order they render. A section sits in one of its layout's regions. */
export const PAGE_LAYOUTS: Record<PageLayout, { label: string; regions: readonly PageRegion[] }> = {
  single: { label: "Single column", regions: ["main"] },
  sidebar: { label: "Main column and sidebar", regions: ["main", "aside"] },
  "hero-grid": { label: "Hero and grid", regions: ["hero", "grid"] },
};

export const pageAccentValidator = v.union(
  v.literal("violet"),
  v.literal("blue"),
  v.literal("teal"),
  v.literal("green"),
  v.literal("amber"),
  v.literal("orange"),
  v.literal("rose"),
  v.literal("slate")
);
export type PageAccent = Infer<typeof pageAccentValidator>;

/** The colour each accent preset renders as. */
export const PAGE_ACCENTS: Record<PageAccent, { label: string; hex: string }> = {
  violet: { label: "Violet", hex: "#8b5cf6" },
  blue: { label: "Blue", hex: "#3b82f6" },
  teal: { label: "Teal", hex: "#14b8a6" },
  green: { label: "Green", hex: "#22c55e" },
  amber: { label: "Amber", hex: "#f59e0b" },
  orange: { label: "Orange", hex: "#f97316" },
  rose: { label: "Rose", hex: "#f43f5e" },
  slate: { label: "Slate", hex: "#64748b" },
};

export const pageThemeValidator = v.object({
  accent: pageAccentValidator,
  banner: v.optional(pageImageValidator),
  avatar: v.optional(pageImageValidator),
});
export type PageTheme = Infer<typeof pageThemeValidator>;

/** A subscriber tier, 1 to 3 as Twitch numbers them. */
export const subscriberTierValidator = v.union(v.literal(1), v.literal(2), v.literal(3));
export type SubscriberTier = Infer<typeof subscriberTierValidator>;

/**
 * Who may see a section. `subscriber` is any tier; `tier` is that tier or
 * higher. Anything but `public` needs to know who the viewer is, and a section
 * is withheld from every viewer it cannot be shown to be visible to.
 */
export const sectionVisibilityValidator = v.union(
  v.object({ kind: v.literal("public") }),
  v.object({ kind: v.literal("signed_in") }),
  v.object({ kind: v.literal("follower") }),
  v.object({ kind: v.literal("subscriber") }),
  v.object({ kind: v.literal("tier"), level: subscriberTierValidator })
);
export type SectionVisibility = Infer<typeof sectionVisibilityValidator>;
export type SectionVisibilityKind = SectionVisibility["kind"];

export const pageSectionValidator = v.object({
  id: v.string(),
  region: pageRegionValidator,
  title: v.optional(v.string()),
  visibility: sectionVisibilityValidator,
  widgets: v.array(pageWidgetValidator),
});
export type PageSection = Infer<typeof pageSectionValidator>;

export const pageContentValidator = v.object({
  layout: pageLayoutValidator,
  theme: pageThemeValidator,
  sections: v.array(pageSectionValidator),
});
export type PageContent = Infer<typeof pageContentValidator>;

/** What a page starts as before its owner changes anything. */
export function defaultPageContent(): PageContent {
  return { layout: "single", theme: { accent: "violet" }, sections: [] };
}

export function isPublicSection(section: PageSection): boolean {
  return section.visibility.kind === "public";
}

/**
 * Everything wrong with `content` that its shape does not already rule out.
 * Convex refuses a save that has any problem, and the editor shows the same
 * list against each field.
 */
export function checkPageContent(content: PageContent): PageCheck<PageContent> {
  const problems: PageProblem[] = [];
  const report = ProblemReport.root(problems);

  const theme = report.field("theme");
  if (content.theme.banner) {
    checkImage(content.theme.banner, theme.field("banner"));
  }
  if (content.theme.avatar) {
    checkImage(content.theme.avatar, theme.field("avatar"));
  }

  const sections = report.field("sections");
  sections.count(content.sections.length, "sections", USER_PAGE_LIMITS.sections);
  const regions = PAGE_LAYOUTS[content.layout].regions;
  let widgetCount = 0;
  content.sections.forEach((section, sectionIndex) => {
    const at = sections.item(sectionIndex);
    checkId(section.id, at.field("id"));
    if (!regions.includes(section.region)) {
      at.field("region").add(`The ${PAGE_LAYOUTS[content.layout].label} layout has no "${section.region}" region`);
    }
    if (section.title !== undefined) {
      at.field("title").text(section.title, "Title", USER_PAGE_LIMITS.sectionTitleLength);
    }
    const widgets = at.field("widgets");
    widgets.count(section.widgets.length, "widgets", USER_PAGE_LIMITS.widgetsPerSection);
    section.widgets.forEach((widget, widgetIndex) => {
      checkWidget(widget, widgets.item(widgetIndex));
    });
    widgetCount += section.widgets.length;
  });
  if (widgetCount > USER_PAGE_LIMITS.widgetsPerPage) {
    sections.add(`${widgetCount} widgets on the page; the most is ${USER_PAGE_LIMITS.widgetsPerPage}`);
  }

  checkUniqueIds(
    content.sections.map((section) => section.id),
    sections
  );
  const widgetIds = content.sections.flatMap((section) => section.widgets.map((widget) => widget.id));
  if (new Set(widgetIds).size !== widgetIds.length) {
    sections.add("Two widgets have the same id");
  }

  return checked(content, problems);
}

/**
 * Every engine resource the given sections bind, in page order, once per
 * resource and kind: two widgets binding one id as different kinds are both
 * kept, so the kind check catches whichever is wrong.
 */
export function pageBindings(sections: readonly PageSection[]): ResourceBinding[] {
  const unique = new Map<string, ResourceBinding>();
  for (const section of sections) {
    for (const widget of section.widgets) {
      for (const binding of widgetBindings(widget)) {
        unique.set(`${binding.kind} ${binding.canonicalId}`, binding);
      }
    }
  }
  return [...unique.values()];
}
