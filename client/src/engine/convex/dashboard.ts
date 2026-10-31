import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { InstanceNote } from "@convex/dashboardNotes";
import { useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import type { DashboardGateway } from "@/engine/gateway";
import { useEngineScope } from "@/engine/scope";
import type {
  DashboardNote,
  DashboardPanelWidget,
  DashboardRailWidget,
  NewStreamHighlight,
  StreamHighlight,
  StreamHighlightId,
} from "@/engine/types";
import { useOptimisticInstanceQueryFor } from "@/hooks/use-optimistic-instance-query";
import { fromInstanceId, fromStreamHighlightId, toStreamHighlightId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";
import { useInstanceMutation, useScopeInstanceId } from "./scope";

// Convex keeps the layout per user and instance, and the notes, pinned
// counters and highlights per instance, shared by its members. Layouts are
// read with the scope's optimistic id, so the dashboard draws the saved
// layout before the membership list loads.

type HighlightRow = Doc<"streamHighlights">;
type CounterRow = Doc<"dashboardCounters">;

function toDashboardNote(note: InstanceNote): DashboardNote {
  return {
    content: note.content,
    updatedAt: note.updatedAt,
    updatedByName: note.updatedByName,
    updatedByMe: note.updatedByMe,
  };
}

function toStreamHighlight(row: HighlightRow): StreamHighlight {
  return {
    id: toStreamHighlightId(row._id),
    kind: row.kind,
    userName: row.userName,
    detail: row.detail ?? null,
    amount: row.amount ?? null,
    occurredAt: row.occurredAt,
  };
}

function toCanonicalId(row: CounterRow): string {
  return row.canonicalId;
}

/** A layout read keyed by the scope's optimistic instance, as the dashboard has always drawn it. */
function useLayoutQuery<
  Query extends typeof api.dashboardLayouts.getPanels | typeof api.dashboardLayouts.getRailWidgets,
>(query: Query) {
  const { optimisticInstanceId, isInstanceLoading } = useEngineScope();
  return useOptimisticInstanceQueryFor(
    query,
    optimisticInstanceId ? fromInstanceId(optimisticInstanceId) : null,
    isInstanceLoading
  );
}

function usePanels() {
  return useLayoutQuery(api.dashboardLayouts.getPanels);
}

function useAddPanelRequest() {
  const addPanel = useInstanceMutation(api.dashboardLayouts.addPanel);
  return useCallback((layoutId: string, name?: string) => addPanel({ layoutId, name }), [addPanel]);
}

function useRemovePanelRequest() {
  const removePanel = useInstanceMutation(api.dashboardLayouts.removePanel);
  return useCallback(
    async (panelId: string) => {
      await removePanel({ panelId });
    },
    [removePanel]
  );
}

function useRenamePanelRequest() {
  const renamePanel = useInstanceMutation(api.dashboardLayouts.renamePanel);
  return useCallback(
    async (panelId: string, name: string) => {
      await renamePanel({ panelId, name });
    },
    [renamePanel]
  );
}

function useSetPanelWidgetsRequest() {
  const setPanelWidgets = useInstanceMutation(api.dashboardLayouts.setPanelWidgets);
  return useCallback(
    async (panelId: string, widgets: DashboardPanelWidget[]) => {
      await setPanelWidgets({ panelId, widgets });
    },
    [setPanelWidgets]
  );
}

function useRailWidgets() {
  return useLayoutQuery(api.dashboardLayouts.getRailWidgets);
}

function useSetRailWidgetsRequest() {
  const setRailWidgets = useInstanceMutation(api.dashboardLayouts.setRailWidgets);
  return useCallback(
    async (widgets: DashboardRailWidget[]) => {
      await setRailWidgets({ widgets });
    },
    [setRailWidgets]
  );
}

function useNote() {
  const instanceId = useScopeInstanceId();
  const note = useQuery(api.dashboardNotes.get, instanceId ? { instanceId } : "skip");
  return useMappedValue(note, toDashboardNote);
}

function useSaveNoteRequest() {
  const save = useInstanceMutation(api.dashboardNotes.save);
  return useCallback(
    async (content: string) => {
      await save({ content });
    },
    [save]
  );
}

function usePinnedCounters() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.dashboardCounters.list, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toCanonicalId);
}

function usePinCounterRequest() {
  const add = useInstanceMutation(api.dashboardCounters.add);
  return useCallback(
    async (canonicalId: string) => {
      await add({ canonicalId });
    },
    [add]
  );
}

function useUnpinCounterRequest() {
  const remove = useInstanceMutation(api.dashboardCounters.remove);
  return useCallback(
    async (canonicalId: string) => {
      await remove({ canonicalId });
    },
    [remove]
  );
}

function useHighlights() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.activityPanel.listHighlights, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toStreamHighlight);
}

function useSaveHighlightRequest() {
  const save = useInstanceMutation(api.activityPanel.saveHighlight);
  return useCallback(
    async ({ kind, userName, detail, amount, occurredAt }: NewStreamHighlight) =>
      toStreamHighlightId(await save({ kind, userName, detail, amount, occurredAt })),
    [save]
  );
}

function useRemoveHighlightRequest() {
  const remove = useMutation(api.activityPanel.removeHighlight);
  return useCallback(
    async (highlightId: StreamHighlightId) => {
      await remove({ highlightId: fromStreamHighlightId(highlightId) });
    },
    [remove]
  );
}

export const convexDashboardGateway: DashboardGateway = {
  usePanels,
  useAddPanelRequest,
  useRemovePanelRequest,
  useRenamePanelRequest,
  useSetPanelWidgetsRequest,
  useRailWidgets,
  useSetRailWidgetsRequest,
  useNote,
  useSaveNoteRequest,
  usePinnedCounters,
  usePinCounterRequest,
  useUnpinCounterRequest,
  useHighlights,
  useSaveHighlightRequest,
  useRemoveHighlightRequest,
};
