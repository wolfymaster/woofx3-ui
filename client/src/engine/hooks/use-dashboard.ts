import { useEngineGateway } from "@/engine/context";

/** The viewer's dashboard panels in order; empty until the first is added. */
export function useDashboardPanels() {
  return useEngineGateway().dashboard.usePanels();
}

export function useAddDashboardPanelRequest() {
  return useEngineGateway().dashboard.useAddPanelRequest();
}

export function useRemoveDashboardPanelRequest() {
  return useEngineGateway().dashboard.useRemovePanelRequest();
}

export function useRenameDashboardPanelRequest() {
  return useEngineGateway().dashboard.useRenamePanelRequest();
}

export function useSetDashboardPanelWidgetsRequest() {
  return useEngineGateway().dashboard.useSetPanelWidgetsRequest();
}

/** Null until the rail is first edited. */
export function useDashboardRailWidgets() {
  return useEngineGateway().dashboard.useRailWidgets();
}

export function useSetDashboardRailWidgetsRequest() {
  return useEngineGateway().dashboard.useSetRailWidgetsRequest();
}

export function useDashboardNote() {
  return useEngineGateway().dashboard.useNote();
}

export function useSaveDashboardNoteRequest() {
  return useEngineGateway().dashboard.useSaveNoteRequest();
}

/** Canonical ids of the counters on the command bar, in bar order. */
export function usePinnedCounters() {
  return useEngineGateway().dashboard.usePinnedCounters();
}

export function usePinCounterRequest() {
  return useEngineGateway().dashboard.usePinCounterRequest();
}

export function useUnpinCounterRequest() {
  return useEngineGateway().dashboard.useUnpinCounterRequest();
}

export function useStreamHighlights() {
  return useEngineGateway().dashboard.useHighlights();
}

export function useSaveStreamHighlightRequest() {
  return useEngineGateway().dashboard.useSaveHighlightRequest();
}

export function useRemoveStreamHighlightRequest() {
  return useEngineGateway().dashboard.useRemoveHighlightRequest();
}
