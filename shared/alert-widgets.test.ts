import { describe, expect, it } from "bun:test";
import {
  type AlertTargetUse,
  alertStepTargets,
  alertWidgetName,
  alertWidgetNamesOf,
  DEFAULT_ALERT_WIDGET_NAME,
  nextAlertWidgetName,
  orphanedAlertTargets,
  placedWidgetsOf,
} from "./alert-widgets";

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

describe("alertStepTargets", () => {
  it("reads the target of every Alert step, workflow task or command action", () => {
    const steps = [
      { id: "a", type: "action", action: "alert", parameters: { target: " sidebar ", layout: {} } },
      { action: "alert", parameters: { layout: {} } },
      { id: "c", type: "action", action: "counter.increment", parameters: { target: "deaths" } },
      { action: "alert", parameters: { target: "" } },
    ];
    expect(alertStepTargets(steps)).toEqual(["sidebar", DEFAULT_ALERT_WIDGET_NAME, DEFAULT_ALERT_WIDGET_NAME]);
  });

  it("skips steps that are not objects or have no parameters object", () => {
    expect(alertStepTargets([null, "alert", { action: "alert", parameters: "sidebar" }])).toEqual([
      DEFAULT_ALERT_WIDGET_NAME,
    ]);
  });
});

describe("alertWidgetNamesOf", () => {
  it("names only the widgets that host alerts", () => {
    const names = alertWidgetNamesOf(
      [
        { widgetId: "woofx3:widget:alert", settings: { name: "sidebar" } },
        { widgetId: "woofx3:widget:alert", settings: {} },
        { widgetId: "woofx3:widget:text", settings: { name: "title" } },
      ],
      new Set(["woofx3:widget:alert"])
    );
    expect([...names]).toEqual(["sidebar", DEFAULT_ALERT_WIDGET_NAME]);
  });
});

describe("orphanedAlertTargets", () => {
  const follow: AlertTargetUse = { target: "sidebar", kind: "workflow", name: "Follow alert" };
  const hype: AlertTargetUse = { target: "sidebar", kind: "command", name: "!hype" };
  const raid: AlertTargetUse = { target: "default", kind: "workflow", name: "Raid alert" };
  const set = (...names: string[]) => new Set(names);

  it("lists the targets a rename leaves unanswered, with what uses them", () => {
    expect(
      orphanedAlertTargets([follow, hype, raid], set("sidebar", "default"), set("corner", "default"), set())
    ).toEqual([{ target: "sidebar", uses: [follow, hype] }]);
  });

  it("counts a removed alert area the same as a renamed one", () => {
    expect(orphanedAlertTargets([raid], set("default"), set(), set())).toEqual([{ target: "default", uses: [raid] }]);
  });

  it("leaves out a name another scene still answers to", () => {
    expect(orphanedAlertTargets([follow], set("sidebar"), set(), set("sidebar"))).toEqual([]);
  });

  it("leaves out a target the scene did not answer to before the edit", () => {
    expect(orphanedAlertTargets([follow], set("default"), set("default"), set())).toEqual([]);
  });

  it("lists a workflow once however many of its steps use the target", () => {
    expect(orphanedAlertTargets([follow, follow], set("sidebar"), set(), set())).toEqual([
      { target: "sidebar", uses: [follow] },
    ]);
  });
});

describe("placedWidgetsOf", () => {
  it("leaves out cached entries that are no placement", () => {
    const placed = placedWidgetsOf([
      42,
      null,
      "alert",
      [],
      { settings: { name: "x" } },
      { widgetCanonicalId: "woofx3:widget:alert", settings: { name: "main" } },
      { widgetCanonicalId: "woofx3:widget:text", settings: "not settings" },
    ]);
    expect(placed).toEqual([
      { widgetId: "woofx3:widget:alert", settings: { name: "main" } },
      { widgetId: "woofx3:widget:text", settings: undefined },
    ]);
  });
});
