import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type {
  AuthorPage,
  CatalogCounts,
  CatalogListingDetail,
  CatalogPage,
  ListingQuote,
  ListingType,
} from "@shared/marketplace-catalog";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";

// The marketplace catalog is served by a separate HTTP service through Convex
// *actions*, not queries, so none of it is reactive. These hooks do the one
// thing that matters as a result: they tie every fetched result to the inputs
// it was fetched for, and never show a result belonging to a different
// instance, query or listing. A stale render here is a streamer installing
// something they were not looking at.

/** A fetch that knows which request its result belongs to. */
interface Fetched<Args, Result> {
  args: Args;
  result: Result;
}

export interface MarketplaceSearch {
  page: CatalogPage | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The orders the marketplace can return a page in. */
export type MarketplaceSort = "relevance" | "newest" | "name" | "popular" | "trending";

export interface MarketplaceSearchArgs {
  query: string;
  types: ListingType[];
  category?: string;
  /** Only curated listings, in `featuredRank` order. */
  featured?: boolean;
  sort: MarketplaceSort;
  limit?: number;
  offset?: number;
}

function sameSearch(a: MarketplaceSearchArgs, b: MarketplaceSearchArgs): boolean {
  return (
    a.query === b.query &&
    a.category === b.category &&
    a.featured === b.featured &&
    a.sort === b.sort &&
    a.limit === b.limit &&
    a.offset === b.offset &&
    a.types.length === b.types.length &&
    a.types.every((t, i) => t === b.types[i])
  );
}

/**
 * One page of the catalog, across every listing type.
 *
 * Search runs on the server, so a query change is a round trip rather than a
 * filter over a cached list. The debounce is in the caller (`useDebounced`
 * below) so typing does not fire a request per keystroke.
 */
export function useMarketplaceSearch(
  instanceId: Id<"instances"> | null,
  args: MarketplaceSearchArgs
): MarketplaceSearch {
  const search = useAction(api.marketplaceCatalog.search);
  const [fetched, setFetched] = useState<
    (Fetched<MarketplaceSearchArgs, CatalogPage> & { instanceId: Id<"instances"> }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  // Keyed by the search as well as the instance: a failure belongs to the
  // request that failed, so changing the query or a filter asks again.
  const [error, setError] = useState<{
    instanceId: Id<"instances">;
    args: MarketplaceSearchArgs;
    message: string;
  } | null>(null);

  // The args object is rebuilt on every render by every caller, so the effect
  // below keys off a value compared by content instead.
  const argsRef = useRef(args);
  if (!sameSearch(argsRef.current, args)) {
    argsRef.current = args;
  }
  const stableArgs = argsRef.current;

  const refetch = useCallback(async () => {
    if (!instanceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await search({
        instanceId,
        query: stableArgs.query || undefined,
        types: stableArgs.types.length > 0 ? stableArgs.types : undefined,
        category: stableArgs.category,
        featured: stableArgs.featured,
        sort: stableArgs.sort,
        limit: stableArgs.limit,
        offset: stableArgs.offset,
      });
      setFetched({ instanceId, args: stableArgs, result: page });
    } catch (err) {
      setError({ instanceId, args: stableArgs, message: actionErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [search, instanceId, stableArgs]);

  const current =
    fetched && instanceId && fetched.instanceId === instanceId && sameSearch(fetched.args, stableArgs)
      ? fetched.result
      : null;
  const currentError =
    error && error.instanceId === instanceId && sameSearch(error.args, stableArgs) ? error.message : null;

  useEffect(() => {
    if (instanceId && current === null && !loading && !currentError) {
      void refetch();
    }
  }, [instanceId, current, loading, currentError, refetch]);

  return { page: current, loading, error: currentError, refetch };
}

export interface MarketplaceListing {
  listing: CatalogListingDetail | null;
  /** True once the fetch came back and the marketplace had no such listing. */
  notFound: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** One listing's detail page. */
export function useMarketplaceListing(
  instanceId: Id<"instances"> | null,
  listingId: string | null
): MarketplaceListing {
  const getListing = useAction(api.marketplaceCatalog.getListing);
  const [fetched, setFetched] = useState<{
    instanceId: Id<"instances">;
    listingId: string;
    result: CatalogListingDetail | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ listingId: string; message: string } | null>(null);

  const refetch = useCallback(async () => {
    if (!instanceId || !listingId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setFetched({ instanceId, listingId, result: await getListing({ instanceId, listingId }) });
    } catch (err) {
      setError({ listingId, message: actionErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [getListing, instanceId, listingId]);

  const matches = fetched !== null && fetched.instanceId === instanceId && fetched.listingId === listingId;
  const currentError = error && error.listingId === listingId ? error.message : null;

  useEffect(() => {
    if (instanceId && listingId && !matches && !loading && !currentError) {
      void refetch();
    }
  }, [instanceId, listingId, matches, loading, currentError, refetch]);

  return {
    listing: matches ? fetched.result : null,
    notFound: matches && fetched.result === null,
    loading,
    error: currentError,
    refetch,
  };
}

export interface MarketplaceAuthorResult {
  /** The profile and every listing fetched so far, newest first. */
  page: AuthorPage | null;
  notFound: boolean;
  loading: boolean;
  error: string | null;
  /** More listings than have been fetched. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the last "show more" failed, if it did. */
  loadMoreError: string | null;
  /** Fetches the next page and appends it. */
  loadMore: () => Promise<void>;
}

/** How many of an author's listings each request fetches. */
const AUTHOR_PAGE_SIZE = 48;

/**
 * An author's page: their profile and their listings, a page at a time. The
 * marketplace pages the listings itself, so an author with hundreds of them
 * costs one page to open.
 */
export function useMarketplaceAuthor(instanceId: Id<"instances"> | null, slug: string | null): MarketplaceAuthorResult {
  const getAuthor = useAction(api.marketplaceCatalog.getAuthor);
  const [fetched, setFetched] = useState<{ key: string; result: AuthorPage | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<{ key: string; message: string } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const key = instanceId && slug ? `${instanceId}:${slug}` : null;

  const current = fetched && fetched.key === key ? fetched : null;
  const currentError = error && error.key === key ? error.message : null;

  useEffect(() => {
    if (!instanceId || !slug || !key || current || loading || currentError) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getAuthor({ instanceId, slug, limit: AUTHOR_PAGE_SIZE, offset: 0 })
      .then((result) => {
        if (!cancelled) {
          setFetched({ key, result });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError({ key, message: actionErrorMessage(err) });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthor, instanceId, slug, key, current, loading, currentError]);

  const page = current?.result ?? null;
  const hasMore = page !== null && page.listings.length < page.total;

  const loadMore = useCallback(async () => {
    if (!instanceId || !slug || !key || !page || !hasMore || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await getAuthor({ instanceId, slug, limit: AUTHOR_PAGE_SIZE, offset: page.listings.length });
      if (next) {
        // Ids already shown are dropped, in case a publish shifted the pages.
        const seen = new Set(page.listings.map((l) => l.id));
        setFetched({
          key,
          result: { ...next, listings: [...page.listings, ...next.listings.filter((l) => !seen.has(l.id))] },
        });
      }
    } catch (err) {
      // The listings already shown stay; only the button reports it.
      setMoreError({ key, message: actionErrorMessage(err) });
    } finally {
      setLoadingMore(false);
    }
  }, [getAuthor, instanceId, slug, key, page, hasMore, loadingMore]);

  return {
    page,
    notFound: current !== null && current.result === null,
    loading,
    error: currentError,
    hasMore,
    loadingMore,
    loadMoreError: moreError && moreError.key === key ? moreError.message : null,
    loadMore,
  };
}

export interface MarketplaceQuote {
  quote: ListingQuote | null;
  /** True until the first answer for this listing arrives. */
  loading: boolean;
  /** Set when the quote could not be read; the button then refuses to guess. */
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * What this account must do to hold one listing, as the marketplace decides
 * it: owned, free, an upgrade price, the full price, or unavailable. The
 * listing page's button reads nothing else, because only the marketplace
 * knows what the account holds.
 */
export function useMarketplaceQuote(instanceId: Id<"instances"> | null, listingId: string | null): MarketplaceQuote {
  const getQuote = useAction(api.marketplaceCatalog.quote);
  const [fetched, setFetched] = useState<{ key: string; quote: ListingQuote | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const key = instanceId && listingId ? `${instanceId}:${listingId}` : null;

  const refetch = useCallback(async () => {
    if (!instanceId || !listingId || !key) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setFetched({ key, quote: await getQuote({ instanceId, listingId }) });
    } catch (err) {
      setError({ key, message: actionErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [getQuote, instanceId, listingId, key]);

  const current = fetched && fetched.key === key ? fetched : null;
  const currentError = error && error.key === key ? error.message : null;

  useEffect(() => {
    if (key && current === null && !loading && !currentError) {
      void refetch();
    }
  }, [key, current, loading, currentError, refetch]);

  return {
    quote: current?.quote ?? null,
    loading: current === null && currentError === null,
    error: currentError,
    refetch,
  };
}

export interface MarketplaceEntitlements {
  /** Listing ids this account has bought. */
  owned: Set<string>;
  /** True until the first answer arrives, so a Buy button is not shown early. */
  loading: boolean;
  /**
   * Set when entitlements could not be read — commerce unconfigured, or the
   * marketplace unreachable. Paid listings then show Buy rather than Install,
   * because the server refuses an install it cannot verify either way.
   */
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Which paid listings this account owns.
 *
 * Fetched once for a whole grid rather than per card: every button on the page
 * is answered by one request.
 */
export function useMarketplaceEntitlements(instanceId: Id<"instances"> | null): MarketplaceEntitlements {
  const list = useAction(api.marketplaceCatalog.entitlements);
  const [fetched, setFetched] = useState<{ instanceId: Id<"instances">; ids: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ instanceId: Id<"instances">; message: string } | null>(null);

  const refetch = useCallback(async () => {
    if (!instanceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setFetched({ instanceId, ids: await list({ instanceId }) });
    } catch (err) {
      setError({
        instanceId,
        message: actionErrorMessage(err),
      });
    } finally {
      setLoading(false);
    }
  }, [list, instanceId]);

  const ids = fetched && fetched.instanceId === instanceId ? fetched.ids : null;
  const currentError = error && error.instanceId === instanceId ? error.message : null;

  useEffect(() => {
    if (instanceId && ids === null && !loading && !currentError) {
      void refetch();
    }
  }, [instanceId, ids, loading, currentError, refetch]);

  const owned = useMemo(() => new Set(ids ?? []), [ids]);
  return { owned, loading: ids === null && currentError === null, error: currentError, refetch };
}

export interface MarketplaceCounts {
  /** Null until the first answer arrives, and when the API has no counts route. */
  counts: CatalogCounts | null;
  loading: boolean;
}

/**
 * How many listings of each type the catalog holds.
 *
 * One number per category tile, from one request. A marketplace too old to
 * answer `/catalog/counts` reports null rather than an error: the tiles fall
 * back to counting the listings the page already has, which is a smaller
 * number but never a wrong-looking page.
 */
export function useMarketplaceCounts(instanceId: Id<"instances"> | null): MarketplaceCounts {
  const read = useAction(api.marketplaceCatalog.counts);
  const [fetched, setFetched] = useState<{ instanceId: Id<"instances">; counts: CatalogCounts | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<Id<"instances"> | null>(null);

  const matches = fetched !== null && fetched.instanceId === instanceId;

  useEffect(() => {
    if (!instanceId || matches || loading || failed === instanceId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void read({ instanceId })
      .then((counts) => {
        if (!cancelled) {
          setFetched({ instanceId, counts });
        }
      })
      .catch(() => {
        // Counts are a label beside a tile. Failing to read them is not worth
        // an error panel, and retrying forever is not worth the requests.
        if (!cancelled) {
          setFailed(instanceId);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [read, instanceId, matches, loading, failed]);

  return { counts: matches ? fetched.counts : null, loading };
}

/**
 * `value` after it has been still for `delayMs`.
 *
 * Search is a server round trip, so without this every keystroke is a request
 * and the answers can land out of order.
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
