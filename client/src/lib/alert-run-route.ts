/**
 * One recorded run's own route, so a row in the alert feed can drill into it and the
 * browser's back button works. It sits beside the Alerts route rather than under it:
 * everything below `/stream/alerts/` is read as a menu path.
 */
export const ALERT_RUN_BASE = "/stream/alert-run";
export const ALERT_RUN_ROUTE = `${ALERT_RUN_BASE}/:engineRunId`;

export function alertRunPath(engineRunId: string): string {
  return `${ALERT_RUN_BASE}/${encodeURIComponent(engineRunId)}`;
}
