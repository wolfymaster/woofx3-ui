import { useCallback } from "react";
import { useMarketplaceCheckoutRequest } from "@/engine/hooks/use-marketplace";
import { type PaymentRequest, paymentStartFromCheckout, type StartPayment } from "@/lib/marketplace-payment";
import { marketplaceListingPath } from "@/lib/marketplace-route";

/**
 * Pays for a listing with the marketplace's own Stripe checkout
 * (`marketplaceCatalog.createCheckout`), which returns the browser to the
 * listing's page. That checkout charges the account's current quote for the
 * listing, which is the price the intent records, so it reads no intent id.
 * Only an app with purchases can start one.
 *
 * Transitional: the management plane's billing charges a purchase intent by
 * its id. Replace this with that checkout as soon as Convex can start one,
 * and in any case before the marketplace deletes its own Stripe checkout.
 */
export function useStartPayment(): StartPayment {
  const createCheckout = useMarketplaceCheckoutRequest();
  return useCallback(
    async ({ listingId }: PaymentRequest) =>
      paymentStartFromCheckout(await createCheckout(listingId, marketplaceListingPath(listingId))),
    [createCheckout]
  );
}
