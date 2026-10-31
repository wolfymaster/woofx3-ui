import { useEngineGateway } from "@/engine/context";

export function useMarketplaceSearchRequest() {
  return useEngineGateway().marketplace.useSearchRequest();
}

/** Resolves null for a listing the marketplace does not have. */
export function useMarketplaceListingRequest() {
  return useEngineGateway().marketplace.useListingRequest();
}

/** Resolves null for an author the marketplace does not know. */
export function useMarketplaceAuthorRequest() {
  return useEngineGateway().marketplace.useAuthorRequest();
}

/** Resolves null when the marketplace cannot count listings by type. */
export function useMarketplaceCountsRequest() {
  return useEngineGateway().marketplace.useCountsRequest();
}

/** Needs an account: only call where the marketplace mode has purchases. */
export function useMarketplaceQuoteRequest() {
  return useEngineGateway().marketplace.useQuoteRequest();
}

/** Needs an account: only call where the marketplace mode has purchases. */
export function useMarketplaceEntitlementsRequest() {
  return useEngineGateway().marketplace.useEntitlementsRequest();
}

/** Needs an account: only call where the marketplace mode has purchases. */
export function useMarketplaceCheckoutRequest() {
  return useEngineGateway().marketplace.useCheckoutRequest();
}
