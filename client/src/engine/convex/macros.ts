import { api } from "@convex/_generated/api";
import type { OptimisticUpdate } from "convex/browser";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { MacrosGateway } from "@/engine/gateway";
import type { Macro, MacroId, MacroInput, MacroVariableValue } from "@/engine/types";
import { fromMacroId, toMacroId } from "./ids";
import { useMappedList } from "./mapped";
import { useInstanceAction, useInstanceMutation, useScopeInstanceId } from "./scope";

// Convex keeps the pad in its `macros` table, one row per macro, shared by
// every member of the instance.

type MacroRow = FunctionReturnType<typeof api.macros.list>[number];

function toMacro(row: MacroRow): Macro {
  return {
    id: toMacroId(row.id),
    label: row.label,
    icon: row.icon,
    color: row.color,
    type: row.type,
    config: row.config,
  };
}

function toMacroArgs({ label, icon, color, type, config }: MacroInput) {
  return { label, icon, color, type, config };
}

/**
 * Shows the new order at once: without it a dragged tile springs back to its
 * old slot until the mutation's round trip lands.
 */
const reorderOptimistically: OptimisticUpdate<FunctionArgs<typeof api.macros.reorderMacros>> = (localStore, args) => {
  const current = localStore.getQuery(api.macros.list, { instanceId: args.instanceId });
  if (!current) {
    return;
  }
  const byId = new Map(current.map((macro) => [macro.id, macro]));
  const reordered = args.macroIds.flatMap((id) => {
    const macro = byId.get(id);
    return macro ? [macro] : [];
  });
  localStore.setQuery(api.macros.list, { instanceId: args.instanceId }, reordered);
};

function useMacros() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.macros.list, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toMacro);
}

function useAddRequest() {
  const add = useInstanceMutation(api.macros.addMacro);
  return useCallback(async (input: MacroInput) => toMacroId(await add(toMacroArgs(input))), [add]);
}

function useUpdateRequest() {
  const update = useInstanceMutation(api.macros.updateMacro);
  return useCallback(
    async (macroId: MacroId, input: MacroInput) => {
      await update({ macroId: fromMacroId(macroId), ...toMacroArgs(input) });
    },
    [update]
  );
}

function useDeleteRequest() {
  const remove = useInstanceMutation(api.macros.deleteMacro);
  return useCallback(
    async (macroId: MacroId) => {
      await remove({ macroId: fromMacroId(macroId) });
    },
    [remove]
  );
}

function useReorderRequest() {
  const reorder = useInstanceMutation(api.macros.reorderMacros, reorderOptimistically);
  return useCallback(
    async (macroIds: MacroId[]) => {
      await reorder({ macroIds: macroIds.map(fromMacroId) });
    },
    [reorder]
  );
}

function useRunRequest() {
  const run = useInstanceAction(api.macros.run);
  return useCallback(
    (macroId: MacroId, values: MacroVariableValue[]) => run({ macroId: fromMacroId(macroId), values }),
    [run]
  );
}

export const convexMacrosGateway: MacrosGateway = {
  useMacros,
  useAddRequest,
  useUpdateRequest,
  useDeleteRequest,
  useReorderRequest,
  useRunRequest,
};
