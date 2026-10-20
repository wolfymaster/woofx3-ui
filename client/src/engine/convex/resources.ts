import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { ResourcesGateway } from "@/engine/gateway";
import type { InstanceId, ResourceChanges, ResourceQuery, UploadRequest } from "@/engine/types";

// Each request hook wraps a `useAction`, which Convex memoises on the
// function's name, so the returned function keeps its identity across renders
// and is safe in effect dependencies.

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

function useHostedStorageUsageRequest() {
  const hostedStorageUsage = useAction(api.resources.hostedStorageUsage);
  return useCallback((instanceId: InstanceId) => hostedStorageUsage({ instanceId }), [hostedStorageUsage]);
}

function useUploadGrantRequest() {
  const requestUpload = useAction(api.resources.requestUpload);
  return useCallback(
    (instanceId: InstanceId, file: UploadRequest) => requestUpload({ instanceId, ...file }),
    [requestUpload]
  );
}

function useCompleteUploadRequest() {
  const completeUpload = useAction(api.resources.completeUpload);
  return useCallback(
    (instanceId: InstanceId, resourceId: string) => completeUpload({ instanceId, resourceId }),
    [completeUpload]
  );
}

function useProcessingRequest() {
  const requestProcessing = useAction(api.resources.requestProcessing);
  return useCallback(
    (instanceId: InstanceId, resourceId: string, utility: string) =>
      requestProcessing({ instanceId, resourceId, utility }),
    [requestProcessing]
  );
}

function useCreateFolderRequest() {
  const createFolder = useAction(api.resources.createFolder);
  return useCallback(
    (instanceId: InstanceId, name: string, parentId: string | null) => createFolder({ instanceId, name, parentId }),
    [createFolder]
  );
}

function useUpdateRequest() {
  const update = useAction(api.resources.update);
  return useCallback(
    (instanceId: InstanceId, resourceId: string, changes: ResourceChanges) =>
      update({ instanceId, resourceId, ...changes }),
    [update]
  );
}

function useRemoveRequest() {
  const remove = useAction(api.resources.remove);
  return useCallback((instanceId: InstanceId, resourceId: string) => remove({ instanceId, resourceId }), [remove]);
}

export const convexResourcesGateway: ResourcesGateway = {
  useListRequest,
  useHostedStorageUsageRequest,
  useUploadGrantRequest,
  useCompleteUploadRequest,
  useProcessingRequest,
  useCreateFolderRequest,
  useUpdateRequest,
  useRemoveRequest,
};
