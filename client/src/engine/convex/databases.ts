import { api } from "@convex/_generated/api";
import type { DatabaseRecordCreate, DatabaseRecordUpdate } from "@woofx3/api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import type { DatabaseRecordsView, DatabasesGateway } from "@/engine/gateway";
import { useFetched } from "@/engine/hooks/use-fetched";
import type { ReadOptions } from "@/engine/types";
import { transport } from "@/lib/transport";
import { requireInstance, useScopeInstanceId } from "./scope";

// Rows are the engine's own, read over the live transport like the event log.
// Convex keeps none of them; it only records, as a transient event, that a
// row of a database changed, which is what refetches the reads below.

/** The correlation key the `database.record.changed` webhook's transient is stored under. Must match `databaseChangeKey` in convex/userPageDatabases.ts. */
export function databaseChangeKey(databaseId: string): string {
  return `database:${databaseId}`;
}

/** Calls `refetch` each time the database's change transient is written again. */
function useRefetchOnChange(databaseId: string, refetch: () => void): void {
  const instanceId = useScopeInstanceId();
  const change = useQuery(
    api.transientEvents.get,
    instanceId ? { instanceId, correlationKey: databaseChangeKey(databaseId) } : "skip"
  );
  const marker = change ? `${change._id}:${change.expiresAt}` : null;
  const seen = useRef(marker);
  useEffect(() => {
    if (marker !== null && marker !== seen.current) {
      refetch();
    }
    seen.current = marker;
  }, [marker, refetch]);
}

function useRecords(databaseId: string, view: DatabaseRecordsView, options?: ReadOptions) {
  const instanceId = useScopeInstanceId();
  const request = useCallback(
    (args: { databaseId: string; view: DatabaseRecordsView }) =>
      transport.listDatabaseRecords(requireInstance(instanceId), { databaseId: args.databaseId, ...args.view }),
    [instanceId]
  );
  const fetched = useFetched(request, instanceId && options?.enabled !== false ? { databaseId, view } : "skip");
  useRefetchOnChange(databaseId, fetched.refetch);
  return fetched;
}

function useRecord(databaseId: string, recordId: string, options?: ReadOptions) {
  const instanceId = useScopeInstanceId();
  const request = useCallback(
    (args: { databaseId: string; recordId: string }) =>
      transport.getDatabaseRecord(requireInstance(instanceId), args.databaseId, args.recordId),
    [instanceId]
  );
  const fetched = useFetched(
    request,
    instanceId && recordId !== "" && options?.enabled !== false ? { databaseId, recordId } : "skip"
  );
  useRefetchOnChange(databaseId, fetched.refetch);
  return fetched;
}

function useCreateRequest() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    (create: DatabaseRecordCreate) => transport.createDatabaseRecord(requireInstance(instanceId), create),
    [instanceId]
  );
}

function useUpdateRequest() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    (update: DatabaseRecordUpdate) => transport.updateDatabaseRecord(requireInstance(instanceId), update),
    [instanceId]
  );
}

function useDeleteRequest() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    (databaseId: string, recordId: string) =>
      transport.deleteDatabaseRecord(requireInstance(instanceId), databaseId, recordId),
    [instanceId]
  );
}

export const convexDatabasesGateway: DatabasesGateway = {
  useRecords,
  useRecord,
  useCreateRequest,
  useUpdateRequest,
  useDeleteRequest,
};
