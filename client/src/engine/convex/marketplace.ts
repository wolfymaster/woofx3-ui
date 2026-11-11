import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { MarketplaceGateway } from "@/engine/gateway";
import type {
  InstallAcquireOutcome,
  MarketplaceCheckout,
  MarketplacePageRequest,
  MarketplaceSearchQuery,
  PurchaseCheckoutState,
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

function toMarketplaceCheckout(
  result: FunctionReturnType<typeof api.marketplaceCatalog.createCheckout>
): MarketplaceCheckout {
  switch (result.status) {
    case "redirect":
      return { status: "redirect", url: result.url };
    case "already_entitled":
      return { status: "already_entitled" };
    case "no_payment_needed":
      return { status: "no_payment_needed" };
    case "unavailable":
      return { status: "unavailable", message: result.message };
  }
}

function useCheckoutRequest() {
  const createCheckout = useInstanceAction(api.marketplaceCatalog.createCheckout);
  return useCallback(
    (listingId: string, returnPath: string) => createCheckout({ listingId, returnPath }).then(toMarketplaceCheckout),
    [createCheckout]
  );
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

function usePurchaseCheckoutStateRequest() {
  const read = useInstanceAction(api.billingCommands.marketplaceCheckoutState);
  return useCallback(
    async (checkoutId: string): Promise<PurchaseCheckoutState> => (await read({ checkoutId })).state,
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
  useCheckoutRequest,
  useAcquireForInstallRequest,
  usePurchaseCheckoutRequest,
  usePurchaseCheckoutStateRequest,
};
