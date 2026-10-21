import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
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
type ScopedArgs<Action extends InstanceAction> = Omit<FunctionArgs<Action>, "instanceId">;

/**
 * `useAction` for an action that takes `instanceId`, returning a function
 * that takes the rest of its arguments and fills the instance in from the
 * scope. Rejects with `NoInstanceSelectedError` while the scope has none.
 */
export function useInstanceAction<Action extends InstanceAction>(
  action: Action
): (args: ScopedArgs<Action>) => Promise<FunctionReturnType<Action>> {
  const run = useAction(action);
  const instanceId = useScopeInstanceId();
  return useCallback(
    async (args: ScopedArgs<Action>) => {
      // The spread rebuilds exactly the arguments Action declares, which
      // TypeScript cannot see through Omit on a generic.
      const full = { ...args, instanceId: requireInstance(instanceId) } as FunctionArgs<Action>;
      return (run as (full: FunctionArgs<Action>) => Promise<FunctionReturnType<Action>>)(full);
    },
    [run, instanceId]
  );
}
