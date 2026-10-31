import { useMemo } from "react";
import { Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import { countByType, MarketplaceSidebar, moduleCategories } from "@/components/marketplace/marketplace-sidebar";
import { useEngineScope } from "@/engine/context";
import { useMarketplaceCounts, useMarketplaceSearch } from "@/hooks/use-marketplace";
import {
  MARKETPLACE_AUTHOR_ROUTE,
  MARKETPLACE_LISTING_ROUTE,
  MARKETPLACE_PATH,
  parseMarketplaceFilter,
} from "@/lib/marketplace-route";
import Marketplace from "@/pages/marketplace";
import MarketplaceAuthor from "@/pages/marketplace-author";
import MarketplaceListing from "@/pages/marketplace-listing";

/** How much of the catalog the overview reads. Matches the API's page cap. */
const OVERVIEW_LIMIT = 200;

/**
 * The catalog rail, with the storefront, a listing or an author beside it.
 *
 * The overview lives here because it is the one read that describes the whole
 * catalog: the rail's counts and categories have to stay still while the page
 * beside it changes, and the storefront's "what's new" is its first page, since
 * it is newest-first.
 */
export default function MarketplaceSection() {
  const { instanceId } = useEngineScope();
  const [location] = useLocation();
  const searchString = useSearch();

  const overview = useMarketplaceSearch(instanceId, {
    query: "",
    types: [],
    sort: "newest",
    limit: OVERVIEW_LIMIT,
  });
  const { counts } = useMarketplaceCounts(instanceId);

  const all = overview.page?.listings ?? [];
  const countedTypes = useMemo(() => countByType(all), [all]);
  const categories = useMemo(() => moduleCategories(all), [all]);
  const typeCounts = counts ?? countedTypes;

  const selection = location === MARKETPLACE_PATH ? parseMarketplaceFilter(searchString) : null;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <MarketplaceSidebar
        typeCounts={typeCounts}
        categories={categories}
        total={overview.page?.total ?? 0}
        selection={selection}
      />
      <Switch>
        <Route path={MARKETPLACE_AUTHOR_ROUTE} component={MarketplaceAuthor} />
        <Route path={MARKETPLACE_LISTING_ROUTE} component={MarketplaceListing} />
        <Route path={MARKETPLACE_PATH}>
          <Marketplace overview={overview} typeCounts={typeCounts} />
        </Route>
        <Route>
          <Redirect to={MARKETPLACE_PATH} />
        </Route>
      </Switch>
    </div>
  );
}
