import { api } from "@convex/_generated/api";
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
  iconUrl?: string;
  counts: { triggers: number; actions: number; functions: number; widgets: number };
  updatedAt?: string;
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
export function useMarketplaceCatalog(): MarketplaceCatalog {
  const listMarketplace = useAction(api.marketplace.listModules);
  const [list, setList] = useState<MarketplaceListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMarketplace();
      setList(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace.");
    } finally {
      setLoading(false);
    }
  }, [listMarketplace]);

  useEffect(() => {
    if (list === null && !loading && !error) {
      void refetch();
    }
  }, [list, loading, error, refetch]);

  return { list, loading, error, refetch };
}
