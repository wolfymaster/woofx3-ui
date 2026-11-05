import { useEffect, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { AuthorPage } from "@/engine/types";

export function useMarketplaceAuthor(slug: string): { page: AuthorPage | null; loading: boolean } {
  const requestAuthor = useEngineGateway().marketplace.useAuthorRequest();
  const [page, setPage] = useState<AuthorPage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    requestAuthor(slug)
      .then((next) => {
        if (!cancelled) {
          setPage(next);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, [requestAuthor, slug]);

  return { page, loading };
}
