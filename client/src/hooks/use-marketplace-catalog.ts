import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MarketplaceImages } from "@convex/lib/marketplaceImages";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";

export interface MarketplaceListItem {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  images: MarketplaceImages;
  featuredRank?: number;
  counts: { triggers: number; actions: number; functions: number; widgets: number };
  updatedAt?: string;
  /** "dev" for modules hidden from the public catalog; only instances with dev access are sent them. */
  tier: "public" | "dev";
}

export interface MarketplaceCatalog {
  list: MarketplaceListItem[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Shared marketplace fetch — the catalog is identical regardless of which
// component needs it (sidebar category counts, storefront grid), so this is
// fetched once by the page and passed down rather than duplicated per component.
// It is not identical across instances: one with marketplace dev access also
// sees dev-tier modules, so a fetched list belongs to the instance it was
// fetched for and is discarded when the selection changes.
export function useMarketplaceCatalog(instanceId: Id<"instances"> | null): MarketplaceCatalog {
  const listMarketplace = useAction(api.marketplace.listModules);
  const [fetched, setFetched] = useState<{ instanceId: Id<"instances">; list: MarketplaceListItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<Id<"instances"> | null>(null);

  const refetch = useCallback(async () => {
    if (!instanceId) {
      return;
    }
    setLoading(true);
    setError(null);
    setErrorFor(null);
    try {
      const result = await listMarketplace({ instanceId });
      setFetched({ instanceId, list: result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace.");
      setErrorFor(instanceId);
    } finally {
      setLoading(false);
    }
  }, [listMarketplace, instanceId]);

  const list = fetched && fetched.instanceId === instanceId ? fetched.list : null;
  const currentError = errorFor === instanceId ? error : null;

  useEffect(() => {
    if (instanceId && list === null && !loading && !currentError) {
      void refetch();
    }
  }, [instanceId, list, loading, currentError, refetch]);

  return { list, loading, error: currentError, refetch };
}
