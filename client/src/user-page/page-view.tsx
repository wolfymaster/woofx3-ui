import type { PublicPageLookup } from "@shared/user-pages";
import type { ReactNode } from "react";
import { NotFoundPage } from "./not-found";
import { PageHeader } from "./page-header";
import { PageRegions } from "./page-regions";
import { PageShell } from "./page-shell";
import { PageSkeleton } from "./page-skeleton";

export type PublishedPage = Extract<PublicPageLookup, { kind: "page" }>;

/**
 * What `/u/<slug>` shows for a lookup: undefined while it loads. `claimable`
 * is whether an unclaimed name can still be taken, false until known.
 * `actions` sits at the top right of a published page and `notice` above its
 * sections.
 */
export function UserPageView({
  lookup,
  claimable,
  actions,
  notice,
}: {
  lookup: PublicPageLookup | undefined;
  claimable: boolean;
  actions?: ReactNode;
  notice?: ReactNode;
}) {
  if (lookup === undefined) {
    return <PageSkeleton />;
  }
  switch (lookup.kind) {
    case "page":
      return <PublishedPageView page={lookup} actions={actions} notice={notice} />;
    case "unavailable":
      return <NotFoundPage invite={false} />;
    case "unclaimed":
      return <NotFoundPage invite={claimable} />;
  }
}

function PublishedPageView({ page, actions, notice }: { page: PublishedPage; actions: ReactNode; notice: ReactNode }) {
  return (
    <PageShell accent={page.theme.accent} actions={actions}>
      <PageHeader name={page.slug} theme={page.theme} />
      <main className="mt-10 px-4 sm:px-6">
        {notice}
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
