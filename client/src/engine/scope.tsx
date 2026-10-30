import { createContext, type ReactNode, useContext } from "react";
import type { EngineScope } from "@/engine/types";

// Its own module rather than part of context.tsx: the gateway adapters read
// the scope, and context.tsx imports the adapter it boots with, so keeping
// both there would make the two modules import each other.

const EngineScopeContext = createContext<EngineScope | null>(null);

/**
 * What every gateway throws, or rejects with, for a call made while the scope
 * has no instance.
 */
export class NoInstanceSelectedError extends Error {
  constructor() {
    super("No instance is selected, so there is no engine to ask");
    this.name = "NoInstanceSelectedError";
  }
}

/** Sets the instance the engine hooks and the gateway below it act on. */
export function EngineScopeProvider({ scope, children }: { scope: EngineScope; children: ReactNode }) {
  return <EngineScopeContext.Provider value={scope}>{children}</EngineScopeContext.Provider>;
}

/** The current instance as the provider sees it. Throws outside `EngineScopeProvider`. */
export function useEngineScope(): EngineScope {
  const scope = useContext(EngineScopeContext);
  if (!scope) {
    throw new Error("useEngineScope: no EngineScopeProvider above this component");
  }
  return scope;
}
