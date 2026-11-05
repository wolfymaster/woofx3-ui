import { describe, expect, test } from "bun:test";
import { dismissedItemId, isDismissedDismissibleItemId, isFixedManualItemId } from "./gettingStarted";

describe("getting started item ids", () => {
  test.each([
    ["alerts", true],
    ["overlay", false],
    ["import", false],
    ["test-follow", false],
  ])("%s as a recorded item is %p", (id, expected) => {
    expect(isFixedManualItemId(id)).toBe(expected);
  });

  test.each([
    [dismissedItemId("import"), true],
    [dismissedItemId("your-page"), true],
    [dismissedItemId("overlay"), false],
    ["import", false],
    ["dismissed:", false],
  ])("%s as a dismissal is %p", (id, expected) => {
    expect(isDismissedDismissibleItemId(id)).toBe(expected);
  });
});
