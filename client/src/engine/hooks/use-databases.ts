import { DATABASE_KIND } from "@shared/resource-kinds";
import { useEngineGateway } from "@/engine/context";
import type { DatabaseRecordsView } from "@/engine/gateway";
import type { ReadOptions } from "@/engine/types";
import { useResourceKind } from "./use-module-resources";

/**
 * Whether the engine has databases: its bundled module declares the kind.
 * Undefined while the kinds load.
 */
export function useDatabasesSupported(): boolean | undefined {
  const kind = useResourceKind(DATABASE_KIND);
  return kind === undefined ? undefined : kind !== null;
}

export function useDatabaseRecords(databaseId: string, view: DatabaseRecordsView, options?: ReadOptions) {
  return useEngineGateway().databases.useRecords(databaseId, view, options);
}

export function useDatabaseRecord(databaseId: string, recordId: string, options?: ReadOptions) {
  return useEngineGateway().databases.useRecord(databaseId, recordId, options);
}

export function useCreateDatabaseRecordRequest() {
  return useEngineGateway().databases.useCreateRequest();
}

export function useUpdateDatabaseRecordRequest() {
  return useEngineGateway().databases.useUpdateRequest();
}

export function useDeleteDatabaseRecordRequest() {
  return useEngineGateway().databases.useDeleteRequest();
}
