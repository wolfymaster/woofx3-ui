import type { ResourcesGateway } from "@/engine/gateway";
import type { HostedStorageUsage, ResourceChanges, ResourceQuery, UploadRequest } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/**
 * Uploaded files and folders, read and changed on the engine on demand: it
 * reports no resource events, so nothing is cached. The bytes of an upload go
 * straight to the engine's storage with the grant's URL and headers.
 */
export function directResourcesGateway(runtime: DirectRuntime): ResourcesGateway {
  const list = (query: ResourceQuery) =>
    runtime.call("listResources", (api) =>
      api.listResources({
        folderId: query.folderId ?? null,
        kind: query.kind,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      })
    );

  // A directly driven engine keeps its files in storage of its own choosing,
  // never on the hosted storage a plan limits.
  const hostedStorageUsage = async (): Promise<HostedStorageUsage | null> => null;

  const uploadGrant = async (file: UploadRequest) => {
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error("Empty files cannot be uploaded.");
    }
    return runtime.call("requestUploadUrl", (api) =>
      api.requestUploadUrl({
        name: file.name,
        contentType: file.contentType,
        parentId: file.parentId,
        size: file.size,
      })
    );
  };

  const completeUpload = (resourceId: string) =>
    runtime.call("completeUpload", (api) => api.completeUpload(resourceId));

  const processing = (resourceId: string, utility: string) =>
    runtime.call("requestProcessing", (api) => api.requestProcessing(resourceId, utility));

  const createFolder = async (name: string, parentId: string | null) => {
    const trimmed = requireName(name, "A folder needs a name");
    return runtime.call("createFolder", (api) => api.createFolder(trimmed, parentId));
  };

  const update = async (resourceId: string, changes: ResourceChanges) => {
    const request: ResourceChanges = {};
    if (changes.name !== undefined) {
      request.name = requireName(changes.name, "A name cannot be empty");
    }
    if (changes.parentId !== undefined) {
      request.parentId = changes.parentId;
    }
    return runtime.call("updateResource", (api) => api.updateResource(resourceId, request));
  };

  const remove = (resourceId: string) => runtime.call("deleteResource", (api) => api.deleteResource(resourceId));

  return {
    useListRequest: () => useEngineRequest(list),
    useHostedStorageUsageRequest: () => useEngineRequest(hostedStorageUsage),
    useUploadGrantRequest: () => useEngineRequest(uploadGrant),
    useCompleteUploadRequest: () => useEngineRequest(completeUpload),
    useProcessingRequest: () => useEngineRequest(processing),
    useCreateFolderRequest: () => useEngineRequest(createFolder),
    useUpdateRequest: () => useEngineRequest(update),
    useRemoveRequest: () => useEngineRequest(remove),
  };
}

/** `name` trimmed; throws `refusal` for a blank one, which the engine would store as is. */
function requireName(name: string, refusal: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error(refusal);
  }
  return trimmed;
}
