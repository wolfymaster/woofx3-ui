/**
 * Which slice of the marketplace catalog a request may see.
 *
 * The marketplace hides dev-tier modules (pushed to production for testing,
 * never for regular users) unless a request carries its read-only dev token.
 * This Convex deployment serves every streamer, so the token cannot simply be
 * attached to all requests: it is attached only for instances an operator has
 * flagged with `marketplaceDevAccess`. Every marketplace request must state
 * its access explicitly so no call site can widen it by omission.
 */
export type MarketplaceAccess = "public" | "dev";

/** The access an instance's flag grants. Absent means public. */
export function marketplaceAccessFor(instance: { marketplaceDevAccess?: boolean } | null): MarketplaceAccess {
  return instance?.marketplaceDevAccess === true ? "dev" : "public";
}

/**
 * Request headers for a marketplace API call at `access`.
 *
 * A dev request without a configured token throws instead of falling back to
 * public: the flagged instance would otherwise see a catalog missing exactly
 * the modules it was flagged to test, with nothing saying why.
 */
export function marketplaceRequestHeaders(
  access: MarketplaceAccess,
  devToken: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (access === "public") {
    return headers;
  }
  const token = devToken?.trim();
  if (!token) {
    throw new Error("Marketplace dev access requires MARKETPLACE_DEV_TOKEN to be set");
  }
  headers.Authorization = `Bearer ${token}`;
  return headers;
}
