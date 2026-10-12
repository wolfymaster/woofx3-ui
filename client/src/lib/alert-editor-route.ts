/**
 * The alert editor's own route, so a deep link and the browser's back button work.
 * It sits beside the Alerts route rather than under it: everything below
 * `/stream/alerts/` is read as a menu path.
 */
export const ALERT_EDITOR_BASE = "/stream/alert-editor";
export const ALERT_EDITOR_ROUTE = `${ALERT_EDITOR_BASE}/:event/:triggerId/:actionId`;

export interface AlertEditorTarget {
  event: string;
  triggerId: string;
  actionId: string;
}

export function alertEditorPath({ event, triggerId, actionId }: AlertEditorTarget): string {
  return `${ALERT_EDITOR_BASE}/${encodeURIComponent(event)}/${encodeURIComponent(triggerId)}/${encodeURIComponent(actionId)}`;
}

/**
 * A library alert's editor. Beside the Alerts route for the same reason as the
 * alert editor; it edits the library alert itself, not a step's copy.
 */
export const ALERT_LIBRARY_EDITOR_BASE = "/stream/alert-library";
export const ALERT_LIBRARY_EDITOR_ROUTE = `${ALERT_LIBRARY_EDITOR_BASE}/:compositionId`;

export function libraryAlertEditorPath(engineCompositionId: string): string {
  return `${ALERT_LIBRARY_EDITOR_BASE}/${encodeURIComponent(engineCompositionId)}`;
}
