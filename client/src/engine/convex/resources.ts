import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { ResourcesGateway } from "@/engine/gateway";
import type { InstanceId, ResourceQuery } from "@/engine/types";

function useListRequest() {
  const list = useAction(api.resources.list);
  return useCallback(
    (instanceId: InstanceId, query: ResourceQuery) =>
      list({
        instanceId,
        folderId: query.folderId,
        kind: query.kind,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      }),
    [list]
  );
}

export const convexResourcesGateway: ResourcesGateway = {
  useListRequest,
};
