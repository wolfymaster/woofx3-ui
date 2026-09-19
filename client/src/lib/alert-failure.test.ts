import { describe, expect, test } from "bun:test";
import { describeAlertFailure } from "./alert-failure";

describe("describeAlertFailure", () => {
  // The reason that started all of this: a workflow saved against a module
  // that has since changed. The advice has to name the module, because
  // nothing about "layout must be an object" suggests looking there.
  test("names the stale module for a missing layout", () => {
    const copy = describeAlertFailure("layout must be an object, got nothing");
    expect(copy?.title).toBe("This alert has no layout");
    expect(copy?.hint).toContain("Update the module");
  });

  // The engine wraps its reasons before they reach a workflow run; the scene
  // manager does not. Both must map, because the same failure reaches the UI
  // by two different routes.
  test("unwraps the engine's prefix", () => {
    expect(describeAlertFailure("alert cannot be published: layout must be an object, got nothing")?.title).toBe(
      "This alert has no layout"
    );
  });

  test("tells a malformed layout apart from an absent one", () => {
    expect(describeAlertFailure(`layout must be an object, got the string "default"`)?.title).toBe(
      "This alert's layout is not usable"
    );
  });

  test("distinguishes a mistyped dimension from a zero one", () => {
    const stringy = describeAlertFailure(`layout.width must be a positive number, got the string "1920"`);
    expect(stringy?.title).toBe("This alert's canvas size is invalid");
    expect(stringy?.hint).toContain("not text");

    const zero = describeAlertFailure("layout.height must be a positive number, got number 0");
    expect(zero?.hint).toContain("greater than zero");
  });

  test("maps a missing widget list", () => {
    expect(describeAlertFailure("layout.widgets must be an array, got nothing")?.title).toBe(
      "This alert has no widget list"
    );
  });

  // The failure no validation can catch, and the one where the advice is most
  // of the value: the target name is echoed back so a typo is obvious.
  test("echoes the target name when nothing was listening", () => {
    const copy = describeAlertFailure('no alert widget named "sidebar" on a running scene');
    expect(copy?.title).toBe("No alert widget was listening");
    expect(copy?.hint).toContain('"sidebar"');
  });

  test("maps widgets that cannot play in an alert, and an empty layout", () => {
    expect(describeAlertFailure("no widget in the layout can play in an alert: no such widget")?.title).toBe(
      "None of this alert's widgets can play in an alert"
    );
    expect(describeAlertFailure("the layout contains no widgets")?.title).toBe("This alert has nothing to show");
  });

  // The safety property that makes matching on text acceptable at all: an
  // unrecognised reason is handed back to the caller unchanged rather than
  // mangled into the wrong advice.
  test("returns null for anything it does not recognise", () => {
    expect(describeAlertFailure("message bus not available")).toBeNull();
    expect(describeAlertFailure("")).toBeNull();
    expect(describeAlertFailure("barkloader: function timed out")).toBeNull();
  });
});
