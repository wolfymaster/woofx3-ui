import { useQuery } from "@tanstack/react-query";
import type { DatabaseRecordCreate, DatabaseRecordUpdate } from "@woofx3/api";
import { EngineDisconnectedError } from "@/engine/errors";
import type { DatabaseRecordsView, DatabasesGateway } from "@/engine/gateway";
import { useEngineScope } from "@/engine/scope";
import type { Fetched, ReadOptions } from "@/engine/types";
import { directKeys as k } from "./keys";
import { useConnected, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/**
 * Database rows read from the embedded engine and cached under the database,
 * so the `database.record.changed` frame invalidates every read of it (see
 * invalidations.ts).
 */
export function directDatabasesGateway(runtime: DirectRuntime): DatabasesGateway {
  const useFetchedRead = <T>(
    queryKey: readonly unknown[],
    queryFn: () => Promise<T>,
    options: ReadOptions | undefined
  ): Fetched<T> => {
    const { instanceId } = useEngineScope();
    const connected = useConnected(runtime);
    const query = useQuery(
      {
        queryKey,
        queryFn,
        enabled: instanceId !== null && connected && options?.enabled !== false,
        throwOnError: false,
      },
      runtime.queryClient
    );
    const error = query.error;
    return {
      data: query.data,
      isLoading: query.isLoading,
      error: error === null || error instanceof EngineDisconnectedError ? null : error.message,
      refetch: () => {
        void query.refetch();
      },
    };
  };

  const create = (input: DatabaseRecordCreate) =>
    runtime.call("createDatabaseRecord", (api) => api.createDatabaseRecord(input));
  const update = (input: DatabaseRecordUpdate) =>
    runtime.call("updateDatabaseRecord", (api) => api.updateDatabaseRecord(input));
  const remove = (databaseId: string, recordId: string) =>
    runtime.call("deleteDatabaseRecord", (api) => api.deleteDatabaseRecord(databaseId, recordId));

  return {
    useRecords: (databaseId: string, view: DatabaseRecordsView, options?: ReadOptions) =>
      useFetchedRead(
        k.databases.records(databaseId, view),
        () => runtime.call("listDatabaseRecords", (api) => api.listDatabaseRecords({ databaseId, ...view })),
        options
      ),
    useRecord: (databaseId: string, recordId: string, options?: ReadOptions) =>
      useFetchedRead(
        k.databases.record(databaseId, recordId),
        () => runtime.call("getDatabaseRecord", (api) => api.getDatabaseRecord(databaseId, recordId)),
        { enabled: recordId !== "" && options?.enabled !== false }
      ),
    // A write's change frame invalidates the reads, as for a write made anywhere else.
    useCreateRequest: () => useEngineRequest(create),
    useUpdateRequest: () => useEngineRequest(update),
    useDeleteRequest: () => useEngineRequest(remove),
  };
}
