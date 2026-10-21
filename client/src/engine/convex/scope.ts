import type { Id } from "@convex/_generated/dataModel";
import type { OptimisticUpdate } from "convex/browser";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import { NoInstanceSelectedError, useEngineScope } from "@/engine/scope";
import { fromInstanceId } from "./ids";

// Gateway calls carry no instance: the Convex functions behind them still
// need one, so the adapter takes it from the engine scope here. A request
// keeps its identity until the scope's instance changes, so an effect that
// depends on it runs again for a newly selected instance.

/** The scope's instance as the Convex id; null while none is selected, which a read passes as "skip". */
export function useScopeInstanceId(): Id<"instances"> | null {
  const { instanceId } = useEngineScope();
  return instanceId ? fromInstanceId(instanceId) : null;
}

/** The scope's instance, for a call that cannot be made without one. */
export function requireInstance(instanceId: Id<"instances"> | null): Id<"instances"> {
  if (!instanceId) {
    throw new NoInstanceSelectedError();
  }
  return instanceId;
}

type InstanceAction = FunctionReference<"action", "public", { instanceId: Id<"instances"> }>;
type InstanceMutation = FunctionReference<"mutation", "public", { instanceId: Id<"instances"> }>;
type ScopedArgs<Fn extends InstanceAction | InstanceMutation> = Omit<FunctionArgs<Fn>, "instanceId">;

/** Fills the scope's instance into each call of `run`, rejecting with `NoInstanceSelectedError` while there is none. */
function useWithScopeInstance<Fn extends InstanceAction | InstanceMutation>(
  run: (args: FunctionArgs<Fn>) => Promise<FunctionReturnType<Fn>>
): (args: ScopedArgs<Fn>) => Promise<FunctionReturnType<Fn>> {
  const instanceId = useScopeInstanceId();
  return useCallback(
    async (args: ScopedArgs<Fn>) => {
      // The spread rebuilds exactly the arguments Fn declares, which
      // TypeScript cannot see through Omit on a generic.
      return run({ ...args, instanceId: requireInstance(instanceId) } as FunctionArgs<Fn>);
    },
    [run, instanceId]
  );
}

/**
 * `useAction` for an action that takes `instanceId`, returning a function
 * that takes the rest of its arguments and fills the instance in from the
 * scope. Rejects with `NoInstanceSelectedError` while the scope has none.
 */
export function useInstanceAction<Action extends InstanceAction>(
  action: Action
): (args: ScopedArgs<Action>) => Promise<FunctionReturnType<Action>> {
  const run = useAction(action) as (args: FunctionArgs<Action>) => Promise<FunctionReturnType<Action>>;
  return useWithScopeInstance<Action>(run);
}

/**
 * `useMutation` for a mutation that takes `instanceId`, like
 * `useInstanceAction`. `optimisticUpdate` must be a module-level function, so
 * the returned function keeps its identity.
 */
export function useInstanceMutation<Mutation extends InstanceMutation>(
  mutation: Mutation,
  optimisticUpdate?: OptimisticUpdate<FunctionArgs<Mutation>>
): (args: ScopedArgs<Mutation>) => Promise<FunctionReturnType<Mutation>> {
  const mutate = useMutation(mutation);
  // A ReactMutation's rest-argument signature hides that it takes exactly these arguments.
  const run = useMemo(
    () => (optimisticUpdate ? mutate.withOptimisticUpdate(optimisticUpdate) : mutate),
    [mutate, optimisticUpdate]
  ) as unknown as (args: FunctionArgs<Mutation>) => Promise<FunctionReturnType<Mutation>>;
  return useWithScopeInstance<Mutation>(run);
}
