import {
  addPanel,
  assertRailWidgets,
  type DashboardPanel,
  type DashboardRailWidget,
  removePanel,
  renamePanel,
  setPanelWidgets,
} from "@shared/dashboard-layout";
import type { UISetting } from "@woofx3/api";
import { z } from "zod";
import type { DashboardGateway } from "@/engine/gateway";
import type { DashboardNote, NewStreamHighlight, StreamHighlight, StreamHighlightId } from "@/engine/types";
import { fromStreamHighlightId, toStreamHighlightId } from "./ids";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import {
  parseSetting,
  removeUISetting,
  toSettingValue,
  UI_SETTING_NAMESPACES,
  type UISettingNamespace,
  type UISettingUpdate,
  uiSettingsRead,
  updateUISetting,
} from "./ui-settings";

// The dashboard's state in the engine's local UI settings, one namespace per
// kind: the layout (key "panels", key "rail"), the notes (key "notes"), the
// pinned counters (one key per counter's canonical id) and the highlights
// (one key per highlight). A lone engine has one viewer, so the layout is
// simply the engine's.
//
// The engine stores values it never reads, so whatever comes back is checked
// against these schemas. A value that fails reads as nothing (a logged
// warning, not a broken dashboard), and the next write replaces it.

const LAYOUT_PANELS_KEY = "panels";
const LAYOUT_RAIL_KEY = "rail";
const NOTES_KEY = "notes";

/** Must match MAX_PINNED in convex/dashboardCounters.ts. */
const MAX_PINNED_COUNTERS = 24;
/** Must match MAX_NOTE_LENGTH in convex/dashboardNotes.ts. */
const MAX_NOTE_LENGTH = 20_000;
/** How many highlights the list shows; must match FEED_PAGE_SIZE in convex/activityPanel.ts. */
const HIGHLIGHTS_SHOWN = 50;

const widgetConfigSchema = z.record(z.unknown());

const panelsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    layoutId: z.string(),
    widgets: z.array(
      z.object({
        zoneId: z.string(),
        slotId: z.string().optional(),
        type: z.string(),
        config: widgetConfigSchema.optional(),
        size: z.number().optional(),
      })
    ),
  })
);

const railSchema = z.array(
  z.object({
    slotId: z.string(),
    type: z.string(),
    config: widgetConfigSchema.optional(),
  })
);

const noteSchema = z.object({ content: z.string() });

const pinnedCounterSchema = z.object({ sortOrder: z.number() });

const highlightSchema = z.object({
  kind: z.string(),
  userName: z.string(),
  detail: z.string().optional(),
  amount: z.number().optional(),
  occurredAt: z.number(),
});

const findKey = (settings: UISetting[], key: string): UISetting | null =>
  settings.find((setting) => setting.key === key) ?? null;

function write(value: object): UISettingUpdate {
  return { kind: "write", value: toSettingValue(value) };
}

export function directDashboardGateway(runtime: DirectRuntime): DashboardGateway {
  const { logger } = runtime;
  const { dashboardLayouts, dashboardNotes, dashboardCounters, dashboardHighlights } = UI_SETTING_NAMESPACES;

  // Panels and the rail share one namespace and so one cached read; each
  // names itself in the error a read the engine cannot serve throws.
  const panelsRead = uiSettingsRead(runtime, dashboardLayouts, "dashboard.usePanels");
  const railRead = uiSettingsRead(runtime, dashboardLayouts, "dashboard.useRailWidgets");
  const notesRead = uiSettingsRead(runtime, dashboardNotes, "dashboard.useNote");
  const countersRead = uiSettingsRead(runtime, dashboardCounters, "dashboard.usePinnedCounters");
  const highlightsRead = uiSettingsRead(runtime, dashboardHighlights, "dashboard.useHighlights");

  const readPanels = (setting: UISetting | null): DashboardPanel[] =>
    (setting && parseSetting(logger, panelsSchema, setting)) ?? [];

  // Built once per gateway so each keeps its identity, and a cached read is
  // derived again only when the namespace changes.
  const selectPanels = (settings: UISetting[]) => readPanels(findKey(settings, LAYOUT_PANELS_KEY));
  const selectRail = (settings: UISetting[]): DashboardRailWidget[] | null => {
    const setting = findKey(settings, LAYOUT_RAIL_KEY);
    return setting && parseSetting(logger, railSchema, setting);
  };
  const selectNote = (settings: UISetting[]): DashboardNote | null => {
    const setting = findKey(settings, NOTES_KEY);
    const note = setting && parseSetting(logger, noteSchema, setting);
    if (!setting || !note) {
      return null;
    }
    // One computer is one viewer: every save is this viewer's.
    return { content: note.content, updatedAt: Date.parse(setting.updatedAt), updatedByName: null, updatedByMe: true };
  };
  const pinnedOrder = (settings: UISetting[]): Array<{ canonicalId: string; sortOrder: number }> =>
    settings
      .flatMap((setting) => {
        const pinned = parseSetting(logger, pinnedCounterSchema, setting);
        return pinned ? [{ canonicalId: setting.key, sortOrder: pinned.sortOrder }] : [];
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.canonicalId.localeCompare(b.canonicalId));
  const selectPinned = (settings: UISetting[]): readonly string[] =>
    pinnedOrder(settings).map((pinned) => pinned.canonicalId);
  const selectHighlights = (settings: UISetting[]): StreamHighlight[] =>
    settings
      .flatMap((setting): StreamHighlight[] => {
        const highlight = parseSetting(logger, highlightSchema, setting);
        if (!highlight) {
          return [];
        }
        return [
          {
            id: toStreamHighlightId(setting.key),
            kind: highlight.kind,
            userName: highlight.userName,
            detail: highlight.detail ?? null,
            amount: highlight.amount ?? null,
            occurredAt: highlight.occurredAt,
          },
        ];
      })
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, HIGHLIGHTS_SHOWN);

  const editPanels = async (member: string, edit: (panels: DashboardPanel[]) => DashboardPanel[]): Promise<void> => {
    await updateUISetting(
      runtime,
      dashboardLayouts,
      LAYOUT_PANELS_KEY,
      (current) => write(edit(readPanels(current))),
      member
    );
  };

  /** Stores `value` under `key` whatever is there now: the last write wins. */
  const replace = async (namespace: UISettingNamespace, key: string, value: object, member: string) => {
    await updateUISetting(runtime, namespace, key, () => write(value), member);
  };

  const addPanelRequest = async (layoutId: string, name?: string): Promise<string> => {
    const panelId = runtime.newId();
    await editPanels("dashboard.useAddPanelRequest", (panels) => addPanel(panels, panelId, layoutId, name));
    return panelId;
  };
  const removePanelRequest = (panelId: string) =>
    editPanels("dashboard.useRemovePanelRequest", (panels) => removePanel(panels, panelId));
  const renamePanelRequest = (panelId: string, name: string) =>
    editPanels("dashboard.useRenamePanelRequest", (panels) => renamePanel(panels, panelId, name));
  const setPanelWidgetsRequest = (panelId: string, widgets: DashboardPanel["widgets"]) =>
    editPanels("dashboard.useSetPanelWidgetsRequest", (panels) => setPanelWidgets(panels, panelId, widgets));

  const setRailWidgetsRequest = async (widgets: DashboardRailWidget[]): Promise<void> => {
    assertRailWidgets(widgets);
    await replace(dashboardLayouts, LAYOUT_RAIL_KEY, widgets, "dashboard.useSetRailWidgetsRequest");
  };

  const saveNoteRequest = async (content: string): Promise<void> => {
    if (content.length > MAX_NOTE_LENGTH) {
      throw new Error(`Notes are limited to ${MAX_NOTE_LENGTH} characters`);
    }
    await replace(dashboardNotes, NOTES_KEY, { content }, "dashboard.useSaveNoteRequest");
  };

  const pinCounterRequest = async (canonicalId: string): Promise<void> => {
    const member = "dashboard.usePinCounterRequest";
    const key = canonicalId.trim();
    if (!key) {
      throw new Error("Counter id cannot be empty");
    }
    const pinned = pinnedOrder(await runtime.queryClient.fetchQuery(countersRead));
    const sortOrder = pinned.reduce((max, counter) => Math.max(max, counter.sortOrder), -1) + 1;
    // Created only while the key is absent: pinning one already on the bar keeps its place.
    await updateUISetting(
      runtime,
      dashboardCounters,
      key,
      (current) => {
        if (current) {
          return { kind: "keep" };
        }
        if (pinned.length >= MAX_PINNED_COUNTERS) {
          throw new Error(`The command bar holds at most ${MAX_PINNED_COUNTERS} counters`);
        }
        return write({ sortOrder });
      },
      member
    );
  };
  const unpinCounterRequest = (canonicalId: string) =>
    removeUISetting(runtime, dashboardCounters, canonicalId, "dashboard.useUnpinCounterRequest");

  const saveHighlightRequest = async (highlight: NewStreamHighlight): Promise<StreamHighlightId> => {
    const userName = highlight.userName.trim();
    if (!userName) {
      throw new Error("A highlight needs a name");
    }
    const highlightId = runtime.newId();
    const detail = highlight.detail?.trim();
    await updateUISetting(
      runtime,
      dashboardHighlights,
      highlightId,
      () =>
        write({
          kind: highlight.kind,
          userName,
          ...(detail ? { detail } : {}),
          ...(highlight.amount === undefined ? {} : { amount: highlight.amount }),
          occurredAt: highlight.occurredAt,
        }),
      "dashboard.useSaveHighlightRequest"
    );
    return toStreamHighlightId(highlightId);
  };
  const removeHighlightRequest = (highlightId: StreamHighlightId) =>
    removeUISetting(
      runtime,
      dashboardHighlights,
      fromStreamHighlightId(highlightId),
      "dashboard.useRemoveHighlightRequest"
    );

  return {
    usePanels: () => useEngineQuery(runtime, panelsRead, { select: selectPanels }),
    useAddPanelRequest: () => useEngineRequest(addPanelRequest),
    useRemovePanelRequest: () => useEngineRequest(removePanelRequest),
    useRenamePanelRequest: () => useEngineRequest(renamePanelRequest),
    useSetPanelWidgetsRequest: () => useEngineRequest(setPanelWidgetsRequest),
    useRailWidgets: () => useEngineQuery(runtime, railRead, { select: selectRail }),
    useSetRailWidgetsRequest: () => useEngineRequest(setRailWidgetsRequest),
    useNote: () => useEngineQuery(runtime, notesRead, { select: selectNote }),
    useSaveNoteRequest: () => useEngineRequest(saveNoteRequest),
    usePinnedCounters: () => useEngineQuery(runtime, countersRead, { select: selectPinned }),
    usePinCounterRequest: () => useEngineRequest(pinCounterRequest),
    useUnpinCounterRequest: () => useEngineRequest(unpinCounterRequest),
    useHighlights: () => useEngineQuery(runtime, highlightsRead, { select: selectHighlights }),
    useSaveHighlightRequest: () => useEngineRequest(saveHighlightRequest),
    useRemoveHighlightRequest: () => useEngineRequest(removeHighlightRequest),
  };
}
