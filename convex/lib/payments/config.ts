import { z } from "zod";

// Payments configuration, read once from the deployment's environment and
// validated: a missing or malformed value fails with its name rather than
// letting a blank one stand in.

const portalUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://") || url.startsWith("http://localhost"), "must be https");

const paymentsConfigSchema = z.object({
  BILLING_PROVIDER: z.literal("stripe"),
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, "must be a Stripe secret or restricted key"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_", "must be a Stripe webhook signing secret"),
  ORG_PORTAL_URL: portalUrlSchema,
});

export type PaymentsConfig = z.infer<typeof paymentsConfigSchema>;

export function parsePaymentsConfig(env: Record<string, string | undefined>): PaymentsConfig {
  const parsed = paymentsConfigSchema.safeParse({
    BILLING_PROVIDER: env.BILLING_PROVIDER,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
    ORG_PORTAL_URL: env.ORG_PORTAL_URL,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Payments are misconfigured: ${problems.join("; ")}`);
  }
  return parsed.data;
}

/** The deployment's payments configuration. Throws, naming each bad variable, when it is incomplete. */
export function paymentsConfig(): PaymentsConfig {
  return parsePaymentsConfig(process.env);
}

/** The org portal's public URL (`ORG_PORTAL_URL`), for links in email. Throws naming it when missing or malformed. */
export function orgPortalUrl(): string {
  const parsed = portalUrlSchema.safeParse(process.env.ORG_PORTAL_URL);
  if (!parsed.success) {
    throw new Error(
      `Billing is misconfigured: ORG_PORTAL_URL: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return parsed.data.replace(/\/+$/, "");
}
