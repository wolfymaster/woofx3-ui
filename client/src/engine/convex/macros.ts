import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { MacrosGateway } from "@/engine/gateway";
import type { InstanceId, MacroId, MacroVariableValue } from "@/engine/types";
import { fromInstanceId, fromMacroId } from "./ids";

function useRunRequest() {
  const run = useAction(api.macros.run);
  return useCallback(
    (instanceId: InstanceId, macroId: MacroId, values: MacroVariableValue[]) =>
      run({ instanceId: fromInstanceId(instanceId), macroId: fromMacroId(macroId), values }),
    [run]
  );
}

export const convexMacrosGateway: MacrosGateway = {
  useRunRequest,
};
