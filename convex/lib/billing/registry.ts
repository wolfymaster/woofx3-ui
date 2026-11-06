import type { BillingConfig } from "./config";
import type { BillingProvider, BillingProviderId } from "./provider";
import { StripeBillingProvider, stripeClient } from "./stripe";

type ProviderFactory = (config: BillingConfig, now: () => number) => BillingProvider;

const PROVIDERS: Record<BillingProviderId, ProviderFactory> = {
  stripe: (config, now) => new StripeBillingProvider(stripeClient(config), config.STRIPE_WEBHOOK_SECRET, now),
};

/** The configured provider. An id with no implementation throws. */
export function billingProvider(config: BillingConfig, now: () => number = Date.now): BillingProvider {
  const factory = PROVIDERS[config.BILLING_PROVIDER];
  if (factory === undefined) {
    throw new Error(`No billing provider "${config.BILLING_PROVIDER}"`);
  }
  return factory(config, now);
}
