import { PAGE_LAYOUTS, type PageLayout, type PageRegion, type PublicPageSection } from "@shared/user-pages";
import { PageWidgetView } from "./widgets/page-widget";

/**
 * A page's sections laid out in its layout's regions, each region's sections
 * in page order. On narrow screens every layout is one column, regions in
 * the order PAGE_LAYOUTS lists them.
 */
export function PageRegions({ layout, sections }: { layout: PageLayout; sections: PublicPageSection[] }) {
  const inRegion = (region: PageRegion) => sections.filter((section) => section.region === region);
  const regions = PAGE_LAYOUTS[layout].regions;
  switch (layout) {
    case "single":
      return (
        <div className="mx-auto flex max-w-2xl flex-col gap-6" data-region="main">
          {inRegion("main").map((section) => (
            <SectionView key={section.id} section={section} />
          ))}
        </div>
      );
    case "sidebar":
      return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {regions.map((region) => (
            <div key={region} className="flex flex-col gap-6" data-region={region}>
              {inRegion(region).map((section) => (
                <SectionView key={section.id} section={section} />
              ))}
            </div>
          ))}
        </div>
      );
    case "hero-grid":
      return (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6" data-region="hero">
            {inRegion("hero").map((section) => (
              <SectionView key={section.id} section={section} prominent />
            ))}
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-region="grid">
            {inRegion("grid").map((section) => (
              <SectionView key={section.id} section={section} />
            ))}
          </div>
        </div>
      );
  }
}

/**
 * One section: its title, then its widgets divided by rules. A hero section
 * is set larger and without a panel, so it reads as part of the header.
 */
function SectionView({ section, prominent = false }: { section: PublicPageSection; prominent?: boolean }) {
  const titleId = `section-${section.id}`;
  return (
    <section
      aria-labelledby={section.title === undefined ? undefined : titleId}
      className={prominent ? "py-2 text-lg" : "rounded-2xl border border-line bg-surface p-5 sm:p-6"}
    >
      {section.title !== undefined && (
        <h2 id={titleId} className={`font-bold tracking-tight ${prominent ? "text-3xl" : "text-xl"}`}>
          {section.title}
        </h2>
      )}
      <div className={`flex flex-col divide-y divide-line ${section.title === undefined ? "" : "mt-4"}`}>
        {section.widgets.map((widget) => (
          <div key={widget.id} className="py-5 first:pt-0 last:pb-0">
            <PageWidgetView widget={widget} />
          </div>
        ))}
      </div>
    </section>
  );
}
