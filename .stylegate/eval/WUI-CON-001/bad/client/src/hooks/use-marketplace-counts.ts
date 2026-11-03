import { useEffect, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { CatalogCounts } from "@/engine/types";

export function useMarketplaceCounts(): { counts: CatalogCounts | null; loading: boolean } {
  const requestCounts = useEngineGateway().marketplace.useCountsRequest();
  const [counts, setCounts] = useState<CatalogCounts | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (loading) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    requestCounts()
      .then((next) => {
        if (!cancelled) {
          setCounts(next);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestCounts, loading]);

  return { counts, loading };
}
