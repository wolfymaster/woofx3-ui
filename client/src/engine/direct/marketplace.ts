import {
  type AuthorPage,
  type CatalogCounts,
  type CatalogListingDetail,
  type CatalogPage,
  parseAuthorPage,
  parseCatalogCounts,
  parseCatalogDetail,
  parseCatalogPage,
} from "@shared/marketplace-catalog";
import { parseMarketplaceCatalogError } from "@woofx3/api";
import type { MarketplaceGateway } from "@/engine/gateway";
import type { MarketplacePageRequest, MarketplaceSearchQuery } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { unsupportedRequest } from "./unsupported";

// The engine reads the marketplace with no buyer token: what anyone may see,
// and only free listings install. It passes the marketplace's JSON through
// unchanged, so the answers are parsed exactly as the Convex actions parse
// the marketplace's own. Quotes, entitlements and checkout belong to an
// account, which a lone engine has none of.

/** The marketplace's HTTP status when it refused a read, or null for any other failure. */
function refusedStatus(err: unknown): number | null {
  const failure = parseMarketplaceCatalogError(err);
  return failure?.kind === "http" ? failure.status : null;
}

/** Rethrows a marketplace failure with the marketplace's own message rather than the engine's wire format. */
function rethrowCatalogFailure(err: unknown): never {
  const failure = parseMarketplaceCatalogError(err);
  throw failure === null ? err : new Error(failure.message);
}

export function directMarketplaceGateway(runtime: DirectRuntime): MarketplaceGateway {
  const search = async (query: MarketplaceSearchQuery): Promise<CatalogPage> => {
    try {
      const payload = await runtime.call("marketplaceSearch", (api) =>
        api.marketplaceSearch({
          q: query.query || undefined,
          type: query.types.length > 0 ? query.types : undefined,
          category: query.category,
          // Sent only when asked for: the marketplace reads the parameter's presence.
          featured: query.featured === true ? true : undefined,
          sort: query.sort,
          limit: query.limit,
          offset: query.offset,
        })
      );
      return parseCatalogPage(payload);
    } catch (err) {
      rethrowCatalogFailure(err);
    }
  };

  /** A missing, dev-tier or unpublished listing answers 404 alike. */
  const listing = async (listingId: string): Promise<CatalogListingDetail | null> => {
    try {
      const payload = await runtime.call("marketplaceGetListing", (api) => api.marketplaceGetListing(listingId));
      const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      return parseCatalogDetail(body.listing);
    } catch (err) {
      if (refusedStatus(err) === 404) {
        return null;
      }
      rethrowCatalogFailure(err);
    }
  };

  const author = async (slug: string, page: MarketplacePageRequest): Promise<AuthorPage | null> => {
    try {
      return parseAuthorPage(
        await runtime.call("marketplaceGetAuthor", (api) =>
          api.marketplaceGetAuthor(slug, { limit: page.limit, offset: page.offset })
        )
      );
    } catch (err) {
      if (refusedStatus(err) === 404) {
        return null;
      }
      rethrowCatalogFailure(err);
    }
  };

  /** A marketplace too old to count listings refuses the route with 404 or 400; the tiles then count what they have. */
  const counts = async (): Promise<CatalogCounts | null> => {
    try {
      return parseCatalogCounts(await runtime.call("marketplaceCounts", (api) => api.marketplaceCounts()));
    } catch (err) {
      const status = refusedStatus(err);
      if (status === 404 || status === 400) {
        return null;
      }
      rethrowCatalogFailure(err);
    }
  };

  return {
    useSearchRequest: () => useEngineRequest(search),
    useListingRequest: () => useEngineRequest(listing),
    useAuthorRequest: () => useEngineRequest(author),
    useCountsRequest: () => useEngineRequest(counts),
    useQuoteRequest: unsupportedRequest("marketplace.useQuoteRequest"),
    useEntitlementsRequest: unsupportedRequest("marketplace.useEntitlementsRequest"),
    useCheckoutRequest: unsupportedRequest("marketplace.useCheckoutRequest"),
  };
}
