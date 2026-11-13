import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useCallback } from "react";
import type { MarketplaceGateway } from "@/engine/gateway";
import type {
  InstallAcquireOutcome,
  MarketplacePageRequest,
  MarketplaceSearchQuery,
  PurchaseCheckoutRead,
} from "@/engine/types";
import { useInstanceAction } from "./scope";

// The catalog actions read the marketplace for the instance's account: its
// dev-tier access, and the buyer its quotes, entitlements and checkouts are for.

function useSearchRequest() {
  const search = useInstanceAction(api.marketplaceCatalog.search);
  return useCallback(
    (query: MarketplaceSearchQuery) =>
      search({
        query: query.query || undefined,
        types: query.types.length > 0 ? query.types : undefined,
        category: query.category,
        featured: query.featured,
        sort: query.sort,
        limit: query.limit,
        offset: query.offset,
      }),
    [search]
  );
}

function useListingRequest() {
  const getListing = useInstanceAction(api.marketplaceCatalog.getListing);
  return useCallback((listingId: string) => getListing({ listingId }), [getListing]);
}

function useAuthorRequest() {
  const getAuthor = useInstanceAction(api.marketplaceCatalog.getAuthor);
  return useCallback(
    (slug: string, page: MarketplacePageRequest) => getAuthor({ slug, limit: page.limit, offset: page.offset }),
    [getAuthor]
  );
}

function useCountsRequest() {
  const counts = useInstanceAction(api.marketplaceCatalog.counts);
  return useCallback(() => counts({}), [counts]);
}

function useQuoteRequest() {
  const quote = useInstanceAction(api.marketplaceCatalog.quote);
  return useCallback((listingId: string) => quote({ listingId }), [quote]);
}

function useEntitlementsRequest() {
  const entitlements = useInstanceAction(api.marketplaceCatalog.entitlements);
  return useCallback(() => entitlements({}), [entitlements]);
}

function toInstallAcquireOutcome(
  result: FunctionReturnType<typeof api.marketplaceCatalog.acquireForInstall>
): InstallAcquireOutcome {
  switch (result.status) {
    case "licensed":
      return { status: "licensed", licenseKey: result.license.key };
    case "payment_required":
      return { status: "payment_required", intent: { ...result.intent } };
    case "refused":
      return { status: "refused", reason: result.reason, message: result.message };
  }
}

function useAcquireForInstallRequest() {
  const acquireForInstall = useInstanceAction(api.marketplaceCatalog.acquireForInstall);
  return useCallback(
    (listingId: string) => acquireForInstall({ listingId }).then(toInstallAcquireOutcome),
    [acquireForInstall]
  );
}

function usePurchaseCheckoutRequest() {
  const start = useInstanceAction(api.billingCommands.startMarketplaceCheckout);
  return useCallback((intentId: string) => start({ intentId }), [start]);
}

/**
 * Refusals that decide a checkout read: billing has no such checkout for the
 * engine's organization (also its answer for another organization's), the id
 * is not one billing could have made, or the caller may not ask for that
 * organization. Anything else is an outage the flow asks again after.
 */
const DECIDED_CHECKOUT_REFUSALS: ReadonlySet<string> = new Set([
  "checkout_not_found",
  "bad_request",
  "not_authorized",
  "organization_not_found",
]);

export function checkoutReadOfError(error: unknown): PurchaseCheckoutRead | null {
  if (!(error instanceof ConvexError) || typeof error.data !== "object" || error.data === null) {
    return null;
  }
  const code = (error.data as { code?: unknown }).code;
  return typeof code === "string" && DECIDED_CHECKOUT_REFUSALS.has(code) ? { kind: "not_found" } : null;
}

function usePurchaseCheckoutStateRequest() {
  const read = useInstanceAction(api.billingCommands.marketplaceCheckoutState);
  return useCallback(
    async (checkoutId: string): Promise<PurchaseCheckoutRead> => {
      try {
        return { kind: "state", state: (await read({ checkoutId })).state };
      } catch (error) {
        const decided = checkoutReadOfError(error);
        if (decided === null) {
          throw error;
        }
        return decided;
      }
    },
    [read]
  );
}

export const convexMarketplaceGateway: MarketplaceGateway = {
  useSearchRequest,
  useListingRequest,
  useAuthorRequest,
  useCountsRequest,
  useQuoteRequest,
  useEntitlementsRequest,
  useAcquireForInstallRequest,
  usePurchaseCheckoutRequest,
  usePurchaseCheckoutStateRequest,
};
