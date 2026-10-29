import {
  PAGE_ACCENTS,
  PAGE_LAYOUTS,
  type PageAccent,
  type PageContent,
  type PageLayout,
  type PageRegion,
} from "@shared/user-pages";
import { Check } from "lucide-react";
import type { Dispatch } from "react";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/user-page/fields";
import type { ProblemIndex } from "@/lib/page-problems";
import type { PageEditorAction } from "@/lib/user-page-editor";
import { cn } from "@/lib/utils";

/**
 * How each layout's regions sit, as grid areas for its thumbnail. Record over
 * PageLayout, so a layout added to the registry needs a thumbnail here.
 */
const LAYOUT_THUMBNAILS: Record<PageLayout, { columns: string; rows: string; areas: Record<string, PageRegion> }> = {
  single: { columns: "1fr", rows: "1fr", areas: { "1 / 1 / 2 / 2": "main" } },
  sidebar: { columns: "2fr 1fr", rows: "1fr", areas: { "1 / 1 / 2 / 2": "main", "1 / 2 / 2 / 3": "aside" } },
  "hero-grid": {
    columns: "1fr 1fr",
    rows: "1fr 1.4fr",
    areas: { "1 / 1 / 2 / 3": "hero", "2 / 1 / 3 / 3": "grid" },
  },
};

const LAYOUT_IDS = Object.keys(PAGE_LAYOUTS) as PageLayout[];
const ACCENT_IDS = Object.keys(PAGE_ACCENTS) as PageAccent[];

/** The thumbnail of a layout's regions, tinted with the page's accent and counting the sections in each. */
function LayoutThumbnail({
  layout,
  accentHex,
  sectionCounts,
}: {
  layout: PageLayout;
  accentHex: string;
  sectionCounts: Partial<Record<PageRegion, number>>;
}) {
  const thumbnail = LAYOUT_THUMBNAILS[layout];
  return (
    <div
      className="grid aspect-[4/3] w-full gap-1 rounded-md bg-muted p-1.5"
      style={{ gridTemplateColumns: thumbnail.columns, gridTemplateRows: thumbnail.rows }}
      aria-hidden="true"
    >
      {Object.entries(thumbnail.areas).map(([area, region]) => (
        <div
          key={region}
          className="flex items-end justify-start rounded-sm p-1"
          style={{ gridArea: area, backgroundColor: `${accentHex}33`, boxShadow: `inset 0 0 0 1px ${accentHex}55` }}
        >
          {(sectionCounts[region] ?? 0) > 0 && (
            <span className="font-mono text-[10px] leading-none" style={{ color: accentHex }}>
              {sectionCounts[region]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface PageLookProps {
  content: PageContent;
  problems: ProblemIndex;
  dispatch: Dispatch<PageEditorAction>;
}

/** Layout, accent and the two header images: everything about the page that is not its sections. */
export function PageLook({ content, problems, dispatch }: PageLookProps) {
  const accentHex = PAGE_ACCENTS[content.theme.accent].hex;
  const sectionCounts: Partial<Record<PageRegion, number>> = {};
  for (const section of content.sections) {
    sectionCounts[section.region] = (sectionCounts[section.region] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Layout</legend>
        <div className="grid grid-cols-3 gap-2">
          {LAYOUT_IDS.map((layout) => {
            const selected = content.layout === layout;
            return (
              <button
                key={layout}
                type="button"
                aria-pressed={selected}
                onClick={() => dispatch({ type: "setLayout", layout })}
                className={cn(
                  "relative rounded-lg border-2 p-1.5 text-left hover-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary" : "border-border"
                )}
                data-testid={`button-layout-${layout}`}
              >
                <LayoutThumbnail layout={layout} accentHex={accentHex} sectionCounts={selected ? sectionCounts : {}} />
                <span className="mt-1.5 block text-xs font-medium leading-tight">{PAGE_LAYOUTS[layout].label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Sections in a region the new layout lacks move into its first region.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Accent colour</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
          {ACCENT_IDS.map((accent) => {
            const selected = content.theme.accent === accent;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a swatch is a button styled as a radio, like the theme tiles.
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={PAGE_ACCENTS[accent].label}
                title={PAGE_ACCENTS[accent].label}
                onClick={() => dispatch({ type: "setAccent", accent })}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "ring-2 ring-foreground"
                )}
                style={{ backgroundColor: PAGE_ACCENTS[accent].hex }}
                data-testid={`button-accent-${accent}`}
              >
                {selected && <Check className="h-4 w-4 text-white" />}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-4">
        <Label className="text-sm font-medium">Images</Label>
        <TextField
          id="page-banner-url"
          label="Banner"
          type="url"
          placeholder="https://"
          hint="A wide picture across the top of the page."
          value={content.theme.banner?.url ?? ""}
          onChange={(url) => dispatch({ type: "setImage", slot: "banner", url })}
          path="theme.banner.url"
          problems={problems}
        />
        <TextField
          id="page-avatar-url"
          label="Avatar"
          type="url"
          placeholder="https://"
          hint="A square picture of you or your channel."
          value={content.theme.avatar?.url ?? ""}
          onChange={(url) => dispatch({ type: "setImage", slot: "avatar", url })}
          path="theme.avatar.url"
          problems={problems}
        />
      </div>
    </div>
  );
}
