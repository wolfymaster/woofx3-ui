import { useEffect, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { SupporterPage } from "@/engine/types";

export function useSupporterPage(range: "week" | "month"): SupporterPage | null {
  const requestPage = useEngineGateway().supporters.usePageRequest();
  const [page, setPage] = useState<SupporterPage | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestPage({ range, cursor: page?.nextCursor, signal: controller.signal }).then(setPage, () => undefined);
    return () => controller.abort();
  }, [requestPage, range, page]);

  return page;
}
