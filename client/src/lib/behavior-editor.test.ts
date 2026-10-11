import { describe, expect, it } from "bun:test";
import type { CatalogWidget } from "@woofx3/scene/editor";
import {
  type BehaviorDocument,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  type PlacementDocument,
  PROFILES,
  resolveTimeline,
} from "@woofx3/scene/model";
import {
  activityEditFor,
  activityOf,
  behaviorsOf,
  effectAnchors,
  effectParamFields,
  effectTimingLabel,
  hasActivities,
  kindOptions,
  layerWindowLabel,
  layerWindowOf,
  paramValue,
  previewAnimation,
  timingMsOf,
  trackedLength,
  trackWindowLabel,
  transitionDurationOf,
  transitionOf,
  transitionParamsFor,
  withParam,
} from "@/lib/behavior-editor";

const text: CatalogWidget = {
  widgetId: "woofx3:widget:text",
  name: "Text",
  settings: [],
  behaviorKinds: { transitions: [{ id: "typewriter", label: "Typewriter" }], effects: [] },
};

function behavior(overrides: Partial<BehaviorDocument>): BehaviorDocument {
  return {
    type: "transition",
    kind: "fade",
    target: "w-1",
    order: "a0",
    timing: { anchor: "enter", offsetMs: 0, durationMs: 400, easing: "ease-out" },
    params: { phase: "in" },
    ...overrides,
  };
}

function placement(duration: number): PlacementDocument {
  return {
    widget: "woofx3:widget:image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    z: "a0",
    settings: { duration },
    name: "Image",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  };
}

describe("kindOptions", () => {
  it("offers the host's transitions, then the ones the widget declares", () => {
    const options = kindOptions(text, "transition");
    expect(options.slice(0, 2)).toEqual([
      { value: "fade", label: "Fade", group: "host" },
      { value: "slide", label: "Slide", group: "host" },
    ]);
    expect(options.at(-1)).toEqual({ value: "typewriter", label: "Typewriter", group: "widget" });
  });

  it("offers only the host's kinds for a widget not in the catalog", () => {
    expect(kindOptions(undefined, "effect").map((option) => option.value)).toEqual([
      "shake",
      "pulse",
      "float",
      "glow",
      "flash",
      "blur",
    ]);
  });

  it("lists a stored kind the widget is no longer offered, rather than showing another", () => {
    expect(kindOptions(undefined, "transition", "typewriter").at(-1)).toEqual({
      value: "typewriter",
      label: "typewriter (not available)",
      group: "unavailable",
    });
    expect(
      kindOptions(text, "transition", "typewriter").filter((option) => option.value === "typewriter")
    ).toHaveLength(1);
  });
});

describe("reading a widget's behaviors", () => {
  const behaviors = {
    b: behavior({ type: "effect", kind: "shake", order: "a2", params: {} }),
    a: behavior({ type: "effect", kind: "pulse", order: "a1", params: {} }),
    out: behavior({ kind: "zoom", params: { phase: "out" } }),
    in: behavior({}),
    other: behavior({ target: "w-2" }),
    window: behavior({ type: "activity", kind: "window", params: {} }),
  };

  it("lists a type's behaviors on the target in their order", () => {
    expect(behaviorsOf(behaviors, "w-1", "effect").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("finds the transition for each phase", () => {
    expect(transitionOf(behaviors, "w-1", "in")?.id).toBe("in");
    expect(transitionOf(behaviors, "w-1", "out")?.id).toBe("out");
    expect(transitionOf(behaviors, "w-2", "out")).toBeNull();
  });

  it("finds the activity, and says whether any layer has one", () => {
    expect(activityOf(behaviors, "w-1")?.id).toBe("window");
    expect(hasActivities(behaviors)).toBe(true);
    expect(hasActivities({ in: behaviors.in })).toBe(false);
  });
});

describe("transition values", () => {
  it("holds a typed duration to the registry's limits", () => {
    expect(transitionDurationOf("10")).toBe(MIN_TRANSITION_MS);
    expect(transitionDurationOf("999999")).toBe(MAX_TRANSITION_MS);
    expect(transitionDurationOf("612.4")).toBe(612);
    expect(transitionDurationOf("")).toBeNull();
    expect(transitionDurationOf("fast")).toBeNull();
  });

  it("gives a slide a direction, keeping the one it had, and no other kind one", () => {
    const slideDown = behavior({ kind: "slide", params: { phase: "in", direction: "down" } });
    expect(transitionParamsFor("slide", "in")).toEqual({ phase: "in", direction: "up" });
    expect(transitionParamsFor("slide", "out", slideDown)).toEqual({ phase: "out", direction: "down" });
    expect(transitionParamsFor("zoom", "in", slideDown)).toEqual({ phase: "in" });
  });
});

describe("effect params", () => {
  it("reads each host effect's params, bounds and defaults from the registry", () => {
    expect(effectParamFields("shake").map((field) => field.name)).toEqual(["distancePx", "periodMs"]);
    expect(effectParamFields("pulse")[0]).toMatchObject({ name: "scale", min: 1, max: 3, defaultValue: 1.1 });
    expect(effectParamFields("glow").map((field) => [field.name, field.input])).toEqual([
      ["color", "color"],
      ["radiusPx", "number"],
      ["periodMs", "number"],
    ]);
    expect(effectParamFields("blur")[0]).toMatchObject({ name: "radiusPx", min: 0, minExclusive: true, max: 200 });
    expect(effectParamFields("float").map((field) => field.name)).toEqual(["distancePx", "periodMs"]);
    expect(effectParamFields("flash")[0]).toMatchObject({ name: "brightness", min: 1, max: 5 });
  });

  it("has no params for a kind the widget plays itself", () => {
    expect(effectParamFields("rainbow")).toEqual([]);
  });

  it("shows a stored param, else the overlay's default", () => {
    const [scale] = effectParamFields("pulse");
    expect(paramValue({}, scale)).toBe(1.1);
    expect(paramValue({ scale: 2 }, scale)).toBe(2);
  });

  it("sets a typed param held to its bounds, and refuses what the param cannot take", () => {
    const [scale] = effectParamFields("pulse");
    expect(withParam({ periodMs: 500 }, scale, "9")).toEqual({ periodMs: 500, scale: 3 });
    expect(withParam({}, scale, "0.5")).toEqual({ scale: 1 });
    expect(withParam({}, scale, "big")).toBeNull();
    const [radius] = effectParamFields("blur");
    expect(withParam({}, radius, "0")).toBeNull();
    const [color] = effectParamFields("glow");
    expect(withParam({}, color, "#ff00aa")).toEqual({ color: "#ff00aa" });
    expect(withParam({}, color, "red")).toBeNull();
  });
});

describe("timing", () => {
  it("offers the alert's start as an anchor only where the profile allows it", () => {
    expect(effectAnchors(PROFILES.scene.anchors)).toEqual(["enter"]);
    expect(effectAnchors(PROFILES.alert.anchors)).toEqual(["enter", "start"]);
  });

  it("reads seconds as whole milliseconds", () => {
    expect(timingMsOf("1.25")).toBe(1250);
    expect(timingMsOf("-2")).toBe(0);
    expect(timingMsOf("0", { min: 1 })).toBe(1);
    expect(timingMsOf("")).toBeNull();
  });

  it("says when an effect runs", () => {
    expect(effectTimingLabel({ anchor: "enter", offsetMs: 0, durationMs: "until-exit", easing: "linear" })).toBe(
      "When it enters, until it leaves"
    );
    expect(effectTimingLabel({ anchor: "start", offsetMs: 2000, durationMs: 3500, easing: "linear" })).toBe(
      "2s after the alert starts, for 3.5s"
    );
  });
});

describe("a layer's window", () => {
  const activity = (offsetMs: number, durationMs: number | "until-exit") =>
    behavior({
      type: "activity",
      kind: "window",
      timing: { anchor: "start", offsetMs, durationMs, easing: "linear" },
      params: {},
    });

  it("reads the window an activity sets, and the default without one", () => {
    expect(layerWindowOf(null)).toEqual({ startMs: 0, stayMs: null });
    expect(layerWindowOf(activity(1500, 4000))).toEqual({ startMs: 1500, stayMs: 4000 });
    expect(layerWindowOf(activity(500, "until-exit"))).toEqual({ startMs: 500, stayMs: null });
  });

  it("labels the window", () => {
    expect(layerWindowLabel({ startMs: 0, stayMs: null })).toBe("Starts with the alert, until it completes");
    expect(layerWindowLabel({ startMs: 2000, stayMs: 5000 })).toBe("Starts after 2s, stays 5s");
  });

  it("adds an activity only for a window of its own, and removes it for the default", () => {
    expect(activityEditFor(null, { startMs: 0, stayMs: null })).toEqual({ op: "none" });
    expect(activityEditFor(null, { startMs: 1000, stayMs: null })).toEqual({
      op: "add",
      timing: { anchor: "start", offsetMs: 1000, durationMs: "until-exit" },
    });
    const current = { id: "act", behavior: activity(1000, "until-exit") };
    expect(activityEditFor(current, { startMs: 0, stayMs: null })).toEqual({ op: "remove", id: "act" });
    expect(activityEditFor(current, { startMs: 1000, stayMs: null })).toEqual({ op: "none" });
    expect(activityEditFor(current, { startMs: 1000, stayMs: 3000 })).toEqual({
      op: "patch",
      id: "act",
      timing: { anchor: "start", offsetMs: 1000, durationMs: 3000, easing: "linear" },
    });
  });

  it("reads the alert's length and longest layer from its resolved tracks", () => {
    const doc = {
      layout: { width: 1920, height: 1080 },
      widgets: { a: placement(5), b: placement(3) },
      behaviors: { act: { ...activity(4000, "until-exit"), target: "b" } },
    };
    const tracks = resolveTimeline(doc, PROFILES.alert, { startedAtMs: 0 }, { estimate: {} });
    expect(trackedLength(tracks)).toEqual({ endMs: 7000, longestId: "b" });
    expect(trackWindowLabel(tracks, "b")).toBe("4s–7s");
    expect(trackWindowLabel(tracks, "missing")).toBeNull();
  });
});

describe("previewAnimation", () => {
  it("plays a host transition once over its duration", () => {
    const preview = previewAnimation(
      behavior({ kind: "zoom", timing: { anchor: "enter", offsetMs: 0, durationMs: 600, easing: "ease-out" } })
    );
    expect(preview?.options).toMatchObject({ duration: 600, iterations: 1, easing: "ease-out" });
    expect(preview?.keyframes[0]).toEqual({ opacity: 0, transform: "scale(0.5)" });
  });

  it("plays a repeating effect for a bounded time", () => {
    const preview = previewAnimation(
      behavior({
        type: "effect",
        kind: "pulse",
        timing: { anchor: "enter", offsetMs: 0, durationMs: "until-exit", easing: "ease-in-out" },
        params: { periodMs: 500 },
      })
    );
    expect(preview?.options).toMatchObject({ duration: 500, iterations: 6 });
  });

  it("has nothing to play for a widget's own kind or params the overlay refuses", () => {
    expect(previewAnimation(behavior({ kind: "typewriter" }))).toBeNull();
    expect(
      previewAnimation(
        behavior({
          type: "effect",
          kind: "glow",
          timing: { anchor: "enter", offsetMs: 0, durationMs: 1000, easing: "linear" },
          params: { color: "red" },
        })
      )
    ).toBeNull();
  });
});
