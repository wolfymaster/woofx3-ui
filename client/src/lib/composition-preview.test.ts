import { describe, expect, it } from "bun:test";
import type { CompositionDocument, PlacementDocument } from "@woofx3/scene/model";
import {
  createPreviewUrlCache,
  formatPlayhead,
  overridesOf,
  previewDocumentOf,
  problemText,
  sampleEventOf,
  undrawnIds,
  unseenProblems,
} from "@/lib/composition-preview";
import { variableNames } from "@/lib/variable-display";
import type { VariableOption } from "@/lib/workflow-variables";

const VARIABLES: VariableOption[] = [
  { value: "${trigger.data.user.name}", label: "user.name", group: "Trigger" },
  { value: "${trigger.data.amount}", label: "amount", group: "Trigger" },
  { value: "${increment.next}", label: "Next", group: "Increment" },
];
const NAMES = variableNames(VARIABLES);

function placement(settings: Record<string, unknown>): PlacementDocument {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    visible: true,
    z: "a0",
    settings,
    name: "Text",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  };
}

describe("previewDocumentOf", () => {
  it("shows each reference the step can make by its short name, as the stand-ins do", () => {
    const doc: CompositionDocument = {
      layout: { width: 1920, height: 1080 },
      widgets: {
        a: placement({
          text: "${trigger.data.user.name} gave ${trigger.data.amount}",
          size: 40,
          lines: ["${increment.next}"],
        }),
      },
      behaviors: {},
    };
    const shown = previewDocumentOf(doc, NAMES);
    expect(shown.widgets.a.settings).toEqual({ text: "{name} gave {amount}", size: 40, lines: ["{next}"] });
    // The editor's document is left as it is.
    expect(doc.widgets.a.settings.text).toBe("${trigger.data.user.name} gave ${trigger.data.amount}");
  });

  it("leaves a reference the step cannot make as typed", () => {
    const doc: CompositionDocument = {
      layout: { width: 10, height: 10 },
      widgets: { a: placement({ text: "${gone.value}" }) },
      behaviors: {},
    };
    expect(previewDocumentOf(doc, NAMES).widgets.a.settings.text).toBe("${gone.value}");
  });
});

describe("sampleEventOf", () => {
  it("is an alert event holding the trigger's fields by their short names", () => {
    expect(sampleEventOf(VARIABLES, NAMES)).toEqual({
      type: "alert",
      data: { user: { name: "{name}" }, amount: "{amount}" },
    });
  });

  it("keeps a parent object when a field is declared both as a value and as a parent", () => {
    const variables: VariableOption[] = [
      { value: "${trigger.data.user.name}", label: "", group: "" },
      { value: "${trigger.data.user}", label: "", group: "" },
    ];
    expect(sampleEventOf(variables, variableNames(variables)).data).toEqual({ user: { name: "{name}" } });
  });
});

describe("overridesOf", () => {
  it("lays a gesture's boxes over the document, and nothing without one", () => {
    expect(overridesOf(null)).toBeNull();
    expect(overridesOf({ gesture: "move", boxes: { a: { x: 1, y: 2, width: 3, height: 4, rotation: 5 } } })).toEqual({
      a: { x: 1, y: 2, width: 3, height: 4, rotation: 5 },
    });
  });
});

describe("problems", () => {
  it("keeps the stand-in of a layer the page draws nothing for", () => {
    expect([
      ...undrawnIds([
        { kind: "unknown-widget", id: "a" },
        { kind: "unframed-widget", id: "b" },
        { kind: "plan", id: "fade", detail: "undeclared-kind" },
        { kind: "frames-unavailable" },
      ]),
    ]).toEqual(["a", "b"]);
  });

  it("shows each problem once per editor", () => {
    const seen = new Set<string>();
    const first = unseenProblems(seen, [{ kind: "unknown-widget", id: "a" }]);
    const again = unseenProblems(seen, [
      { kind: "unknown-widget", id: "a" },
      { kind: "plan", id: "fade", detail: "undeclared-kind" },
    ]);
    expect(first).toHaveLength(1);
    expect(again).toEqual([{ kind: "plan", id: "fade", detail: "undeclared-kind" }]);
  });

  it("names the layer a problem is about", () => {
    const labelOf = (id: string) => (id === "a" ? "Headline" : undefined);
    expect(problemText({ kind: "unknown-widget", id: "a" }, labelOf)).toBe(
      "Headline uses a widget that isn't installed on the engine."
    );
    expect(problemText({ kind: "plan", detail: "undeclared-kind" }, labelOf)).toBe(
      "An animation on a layer isn't played: undeclared-kind."
    );
  });
});

describe("createPreviewUrlCache", () => {
  it("reuses a URL while it has time left, and asks again near its expiry or when told to", async () => {
    let time = 0;
    let asked = 0;
    const cache = createPreviewUrlCache(
      async () => {
        asked += 1;
        return { url: `https://scenes.example/preview/composition?token=${asked}`, expiresAt: time + 300_000 };
      },
      () => time
    );
    const first = await cache.get("i");
    expect(await cache.get("i")).toBe(first);
    time = 290_000;
    expect((await cache.get("i"))?.url).toContain("token=2");
    expect((await cache.get("i", { fresh: true }))?.url).toContain("token=3");
    expect(asked).toBe(3);
  });

  it("holds nothing for an engine with no preview", async () => {
    let asked = 0;
    const cache = createPreviewUrlCache(async () => {
      asked += 1;
      return null;
    });
    expect(await cache.get("i")).toBeNull();
    expect(await cache.get("i")).toBeNull();
    expect(asked).toBe(2);
  });
});

describe("formatPlayhead", () => {
  it("shows tenths of a second", () => {
    expect(formatPlayhead(1234)).toBe("1.2s");
    expect(formatPlayhead(-5)).toBe("0.0s");
  });
});
