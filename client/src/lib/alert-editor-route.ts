/**
 * A library alert's editor, on its own route so a deep link and the browser's back
 * button work. It sits beside the Alerts route rather than under it: everything below
 * `/stream/alerts/` is read as a menu path.
 */
export const ALERT_LIBRARY_EDITOR_BASE = "/stream/alert-library";
export const ALERT_LIBRARY_EDITOR_ROUTE = `${ALERT_LIBRARY_EDITOR_BASE}/:compositionId`;

export function libraryAlertEditorPath(engineCompositionId: string): string {
  return `${ALERT_LIBRARY_EDITOR_BASE}/${encodeURIComponent(engineCompositionId)}`;
}
