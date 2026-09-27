import { describe, expect, test } from "bun:test";
import { type ClickTarget, isRowActionClick, ROW_CONTROL_SELECTOR } from "./row-click";

function targetInside(control: boolean): ClickTarget {
  return {
    closest(selector: string) {
      expect(selector).toBe(ROW_CONTROL_SELECTOR);
      return control ? {} : null;
    },
  };
}

describe("isRowActionClick", () => {
  test("acts on a plain click on the row", () => {
    expect(isRowActionClick(targetInside(false), "")).toBe(true);
  });

  test("leaves a click inside a control to that control", () => {
    expect(isRowActionClick(targetInside(true), "")).toBe(false);
  });

  test("does not act when the click ends a text selection", () => {
    expect(isRowActionClick(targetInside(false), "!shoutout")).toBe(false);
  });

  test("does not act without a target", () => {
    expect(isRowActionClick(null, "")).toBe(false);
  });
});
