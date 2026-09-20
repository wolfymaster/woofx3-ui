/**
 * The alert editor's own route, so a deep link and the browser's back button work.
 * It sits beside the Alerts route rather than under it: everything below
 * `/stream/alerts/` is read as a menu path.
 */
export const ALERT_EDITOR_ROUTE = "/stream/alert-editor/:event/:triggerId/:actionId";

export interface AlertEditorTarget {
  event: string;
  triggerId: string;
  actionId: string;
}

export function alertEditorPath({ event, triggerId, actionId }: AlertEditorTarget): string {
  return `/stream/alert-editor/${encodeURIComponent(event)}/${encodeURIComponent(triggerId)}/${encodeURIComponent(actionId)}`;
}
