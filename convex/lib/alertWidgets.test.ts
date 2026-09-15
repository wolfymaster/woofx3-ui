import { describe, expect, it } from "bun:test";
import { alertWidgetName, DEFAULT_ALERT_WIDGET_NAME, nextAlertWidgetName } from "./alertWidgets";

describe("alertWidgetName", () => {
  it("answers to its name setting, trimmed", () => {
    expect(alertWidgetName({ name: " sidebar " })).toBe("sidebar");
  });

  it("answers to the default when the name is blank or missing", () => {
    expect(alertWidgetName({ name: "  " })).toBe(DEFAULT_ALERT_WIDGET_NAME);
    expect(alertWidgetName({})).toBe(DEFAULT_ALERT_WIDGET_NAME);
    expect(alertWidgetName(undefined)).toBe(DEFAULT_ALERT_WIDGET_NAME);
  });
});

describe("nextAlertWidgetName", () => {
  it("names a scene's first alert widget default", () => {
    expect(nextAlertWidgetName([])).toBe("default");
  });

  it("names later ones with the first free number", () => {
    expect(nextAlertWidgetName(["default"])).toBe("alert-2");
    expect(nextAlertWidgetName(["default", "alert-2"])).toBe("alert-3");
    expect(nextAlertWidgetName(["default", "alert-3"])).toBe("alert-2");
  });

  it("reuses default once it is free again", () => {
    expect(nextAlertWidgetName(["alert-2"])).toBe("default");
  });
});
