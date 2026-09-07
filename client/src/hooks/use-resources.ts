import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Resource {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
  /** "image" | "video" | "audio" | "other" | "folder" */
  kind: string;
  contentType: string;
  size: number;
  /** "pending" | "ready" | "failed"; folders are always "ready". */
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceQuery {
  folderId?: string | null;
  kind?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ResourcesState {
  resources: Resource[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Reads the engine's resource list through the Convex proxy.
 *
 * This is a fetch-and-refetch hook rather than a Convex `useQuery`, and that
 * is forced by where the data lives: resources are engine-authoritative and
 * reached through an action, which cannot be subscribed to. See the header of
 * convex/resources.ts for why mirroring them into a Convex table would be
 * worse than this — chiefly that the engine emits no resource webhooks, so the
 * mirror would look live while serving stale rows.
 *
 * Every mutation therefore has to call `refetch()`. Filtering, search and
 * paging are all sent to the engine rather than applied to a local array, so
 * search reaches beyond the current page.
 */
export function useResources(instanceId: Id<"instances"> | undefined, query: ResourceQuery): ResourcesState {
  const list = useAction(api.resources.list);

  const [resources, setResources] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(query.page ?? 1);
  const [pageSize, setPageSize] = useState(query.pageSize ?? 50);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Content key, not identity: `query` is a fresh object every render, so
  // depending on it directly would refetch in a loop.
  const queryKey = JSON.stringify({
    folderId: query.folderId ?? null,
    kind: query.kind ?? null,
    search: query.search ?? "",
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 50,
  });

  // Guards against a slow earlier request resolving after a newer one and
  // overwriting it — easy to hit by typing in the search box.
  const requestSeq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey is a content-key stand-in for `query`, whose identity changes every render
  useEffect(() => {
    if (!instanceId) {
      setResources([]);
      setTotal(0);
      return;
    }
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);

    const parsed = JSON.parse(queryKey) as Required<ResourceQuery>;
    void list({
      instanceId,
      folderId: parsed.folderId,
      kind: parsed.kind ?? undefined,
      search: parsed.search || undefined,
      page: parsed.page,
      pageSize: parsed.pageSize,
    })
      .then((result) => {
        if (seq !== requestSeq.current) {
          return;
        }
        setResources(result.resources);
        setTotal(result.total);
        setPage(result.page);
        setPageSize(result.pageSize);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setResources([]);
        setTotal(0);
      })
      .finally(() => {
        if (seq === requestSeq.current) {
          setIsLoading(false);
        }
      });
  }, [instanceId, queryKey, reloadToken, list]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  return { resources, total, page, pageSize, isLoading, error, refetch };
}
