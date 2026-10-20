import { useEngineGateway } from "@/engine/context";

/** Runs a dashboard macro on the engine; HTTP-request macros are fetched by the browser instead. */
export function useRunMacroRequest() {
  return useEngineGateway().macros.useRunRequest();
}
