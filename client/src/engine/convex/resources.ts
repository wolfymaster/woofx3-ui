import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { ResourcesGateway } from "@/engine/gateway";
import type { ResourceChanges, ResourceQuery, UploadRequest } from "@/engine/types";
import { useInstanceAction } from "./scope";

function useListRequest() {
  const list = useInstanceAction(api.resources.list);
  return useCallback(
    (query: ResourceQuery) =>
      list({
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
  const hostedStorageUsage = useInstanceAction(api.resources.hostedStorageUsage);
  return useCallback(() => hostedStorageUsage({}), [hostedStorageUsage]);
}

function useUploadGrantRequest() {
  const requestUpload = useInstanceAction(api.resources.requestUpload);
  return useCallback(
    (file: UploadRequest) =>
      requestUpload({ name: file.name, contentType: file.contentType, parentId: file.parentId, size: file.size }),
    [requestUpload]
  );
}

function useCompleteUploadRequest() {
  const completeUpload = useInstanceAction(api.resources.completeUpload);
  return useCallback((resourceId: string) => completeUpload({ resourceId }), [completeUpload]);
}

function useProcessingRequest() {
  const requestProcessing = useInstanceAction(api.resources.requestProcessing);
  return useCallback(
    (resourceId: string, utility: string) => requestProcessing({ resourceId, utility }),
    [requestProcessing]
  );
}

function useCreateFolderRequest() {
  const createFolder = useInstanceAction(api.resources.createFolder);
  return useCallback((name: string, parentId: string | null) => createFolder({ name, parentId }), [createFolder]);
}

function useUpdateRequest() {
  const update = useInstanceAction(api.resources.update);
  return useCallback((resourceId: string, changes: ResourceChanges) => update({ resourceId, ...changes }), [update]);
}

function useRemoveRequest() {
  const remove = useInstanceAction(api.resources.remove);
  return useCallback((resourceId: string) => remove({ resourceId }), [remove]);
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
