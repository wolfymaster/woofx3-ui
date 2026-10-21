import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { MacrosGateway } from "@/engine/gateway";
import type { MacroId, MacroVariableValue } from "@/engine/types";
import { fromMacroId } from "./ids";
import { useInstanceAction } from "./scope";

function useRunRequest() {
  const run = useInstanceAction(api.macros.run);
  return useCallback(
    (macroId: MacroId, values: MacroVariableValue[]) => run({ macroId: fromMacroId(macroId), values }),
    [run]
  );
}

export const convexMacrosGateway: MacrosGateway = {
  useRunRequest,
};
