import type { Id } from "@convex/_generated/dataModel";
import { type RequestForQueries, useQueries } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { useInstance } from "@/hooks/use-instance";

type InstanceQuery = FunctionReference<"query", "public", { instanceId: Id<"instances"> }>;

/**
 * useQuery for a query taking only `{ instanceId }`, scoped by
 * `optimisticInstanceId` so it subscribes before the membership list loads.
 *
 * While that id is still unconfirmed, an error reads as "not loaded yet"
 * instead of throwing: a cached id can be malformed for this deployment (one
 * persisted against another Convex URL) and fail argument validation, and the
 * confirmed id replaces it one round trip later. Once confirmed, errors throw
 * as they would from useQuery.
 */
export function useOptimisticInstanceQuery<Query extends InstanceQuery>(
  query: Query
): FunctionReturnType<Query> | undefined {
  const { optimisticInstanceId, isLoading } = useInstance();

  const queries = useMemo((): RequestForQueries => {
    if (!optimisticInstanceId) {
      return {};
    }
    return { result: { query, args: { instanceId: optimisticInstanceId } } };
  }, [query, optimisticInstanceId]);
  const result: unknown = useQueries(queries).result;

  if (result instanceof Error) {
    if (isLoading) {
      return undefined;
    }
    throw result;
  }
  return result as FunctionReturnType<Query> | undefined;
}
