import { useEngineGateway } from "@/engine/context";

/** The instance's macro pad, in the order shown. */
export function useMacros() {
  return useEngineGateway().macros.useMacros();
}

export function useAddMacroRequest() {
  return useEngineGateway().macros.useAddRequest();
}

export function useUpdateMacroRequest() {
  return useEngineGateway().macros.useUpdateRequest();
}

export function useDeleteMacroRequest() {
  return useEngineGateway().macros.useDeleteRequest();
}

export function useReorderMacrosRequest() {
  return useEngineGateway().macros.useReorderRequest();
}

/** Runs a dashboard macro on the engine; HTTP-request macros are fetched by the browser instead. */
export function useRunMacroRequest() {
  return useEngineGateway().macros.useRunRequest();
}
