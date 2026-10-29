import type { PublicPageLookup } from "@shared/user-pages";
import { NotFoundPage } from "./not-found";
import { PageHeader } from "./page-header";
import { PageRegions } from "./page-regions";
import { PageShell } from "./page-shell";
import { PageSkeleton } from "./page-skeleton";

export type PublishedPage = Extract<PublicPageLookup, { kind: "page" }>;

/**
 * What `/u/<slug>` shows for a lookup: undefined while it loads. `claimable`
 * is whether an unclaimed name can still be taken, false until known.
 */
export function UserPageView({ lookup, claimable }: { lookup: PublicPageLookup | undefined; claimable: boolean }) {
  if (lookup === undefined) {
    return <PageSkeleton />;
  }
  switch (lookup.kind) {
    case "page":
      return <PublishedPageView page={lookup} />;
    case "unavailable":
      return <NotFoundPage invite={false} />;
    case "unclaimed":
      return <NotFoundPage invite={claimable} />;
  }
}

function PublishedPageView({ page }: { page: PublishedPage }) {
  return (
    <PageShell accent={page.theme.accent}>
      <PageHeader name={page.slug} theme={page.theme} />
      <main className="mt-10 px-4 sm:px-6">
        <PageRegions layout={page.layout} sections={page.sections} />
      </main>
    </PageShell>
  );
}

/** The browser tab's title for a lookup. */
export function documentTitle(lookup: PublicPageLookup | undefined): string {
  if (lookup === undefined) {
    return "woofx3";
  }
  return lookup.kind === "page" ? `${lookup.slug} on woofx3` : "Page not found | woofx3";
}
