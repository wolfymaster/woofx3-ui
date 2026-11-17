import { describe, expect, test } from "bun:test";
import { ALERT_GROUPS_PATH, LEGACY_ALERT_GROUPS_PATH, legacyAlertGroupsRedirect } from "./alert-groups-route";

describe("legacyAlertGroupsRedirect", () => {
  test.each([
    ["the list", LEGACY_ALERT_GROUPS_PATH, ALERT_GROUPS_PATH],
    ["a new group", `${LEGACY_ALERT_GROUPS_PATH}/new`, `${ALERT_GROUPS_PATH}/new`],
    ["a group by id", `${LEGACY_ALERT_GROUPS_PATH}/a%2Fb`, `${ALERT_GROUPS_PATH}/a%2Fb`],
  ])("%s", (_case, from, to) => {
    expect(legacyAlertGroupsRedirect(from)).toBe(to);
  });
});
