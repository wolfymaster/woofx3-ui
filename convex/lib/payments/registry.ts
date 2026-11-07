import type { PaymentsConfig } from "./config";
import type { PaymentProvider, PaymentProviderId } from "./provider";
import { StripePaymentProvider, stripeClient } from "./stripe";

type ProviderFactory = (config: PaymentsConfig, now: () => number) => PaymentProvider;

const PROVIDERS: Record<PaymentProviderId, ProviderFactory> = {
  stripe: (config, now) => new StripePaymentProvider(stripeClient(config), config.STRIPE_WEBHOOK_SECRET, now),
};

/** The configured provider. An id with no implementation throws. */
export function paymentProvider(config: PaymentsConfig, now: () => number = Date.now): PaymentProvider {
  const factory = PROVIDERS[config.BILLING_PROVIDER];
  if (factory === undefined) {
    throw new Error(`No payment provider "${config.BILLING_PROVIDER}"`);
  }
  return factory(config, now);
}
