import { describe, expect, test } from "bun:test";
import { NEW_COMMAND_KEY } from "@/lib/command-drafts";
import {
  COMMAND_EDITOR_ROUTE,
  COMMAND_GROUP_EDITOR_ROUTE,
  COMMAND_GROUP_NEW_ROUTE,
  COMMAND_GROUPS_PATH,
  COMMAND_LIST_PATH,
  COMMAND_NEW_ROUTE,
  COMMAND_STEP_ALERT_ROUTE,
  commandEditorPath,
  commandGroupEditorPath,
  commandStepAlertPath,
} from "@/lib/command-editor-route";

describe("command editor paths", () => {
  test("a command's page hangs off the list", () => {
    expect(commandEditorPath("abc-123")).toBe("/stream/commands/abc-123");
  });

  test("a group's page hangs off the groups list", () => {
    expect(commandGroupEditorPath("grp-1")).toBe("/stream/commands/groups/grp-1");
  });

  test("a step's alert content hangs off its command", () => {
    expect(commandStepAlertPath("abc-123", "action-2")).toBe("/stream/commands/abc-123/steps/action-2/alert");
  });

  test("a command still being created uses the key its draft is held under", () => {
    expect(commandStepAlertPath(undefined, "action-1")).toBe(
      `/stream/commands/${NEW_COMMAND_KEY}/steps/action-1/alert`
    );
  });

  test("ids that would otherwise change the path are encoded", () => {
    expect(commandEditorPath("a/b")).toBe("/stream/commands/a%2Fb");
    expect(commandStepAlertPath("a/b", "s/1")).toBe("/stream/commands/a%2Fb/steps/s%2F1/alert");
    expect(commandGroupEditorPath("a/b")).toBe("/stream/commands/groups/a%2Fb");
  });
});

describe("route patterns", () => {
  // Every editor sits under the list, which is what keeps the Commands menu entry
  // active while one is open — isNavItemActive matches on this prefix.
  test("every route is under the commands list", () => {
    for (const route of [
      COMMAND_NEW_ROUTE,
      COMMAND_EDITOR_ROUTE,
      COMMAND_STEP_ALERT_ROUTE,
      COMMAND_GROUPS_PATH,
      COMMAND_GROUP_NEW_ROUTE,
      COMMAND_GROUP_EDITOR_ROUTE,
    ]) {
      expect(route.startsWith(`${COMMAND_LIST_PATH}/`)).toBe(true);
    }
  });

  // The fixed segments are matched before :engineCommandId when they are registered;
  // these assert they are the literals that ordering assumes.
  test("the fixed segments are literal, not parameters", () => {
    expect(COMMAND_NEW_ROUTE).toBe(`/stream/commands/${NEW_COMMAND_KEY}`);
    expect(COMMAND_GROUPS_PATH).toBe("/stream/commands/groups");
    expect(COMMAND_GROUP_NEW_ROUTE).toBe("/stream/commands/groups/new");
  });

  test("a new command's step alert path is matched by the command step route", () => {
    const pattern = COMMAND_STEP_ALERT_ROUTE.replace(":engineCommandId", NEW_COMMAND_KEY).replace(
      ":actionId",
      "action-1"
    );
    expect(commandStepAlertPath(undefined, "action-1")).toBe(pattern);
  });
});
