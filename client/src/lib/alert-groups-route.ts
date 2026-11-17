/** Where the alert group pages live: the list, and a group below it (`new` for a new one). */
export const ALERT_GROUPS_PATH = "/stream/alert-groups";
export const NEW_ALERT_GROUP_SEGMENT = "new";

/** Where they lived below the Alerts route; links to it forward to `ALERT_GROUPS_PATH`. */
export const LEGACY_ALERT_GROUPS_PATH = "/stream/alerts/groups";

/** `location`, a path at or below `LEGACY_ALERT_GROUPS_PATH`, moved to the same place below `ALERT_GROUPS_PATH`. */
export function legacyAlertGroupsRedirect(location: string): string {
  return ALERT_GROUPS_PATH + location.slice(LEGACY_ALERT_GROUPS_PATH.length);
}
