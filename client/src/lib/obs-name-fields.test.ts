import { describe, expect, test } from "bun:test";
import type { ObsScene } from "@convex/lib/obsScenes";
import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  isAudioInputKind,
  obsNameGroups,
  obsNameMismatch,
  obsNameSourceOf,
  withObsNameSources,
} from "./obs-name-fields";

// biome-ignore lint/suspicious/noTemplateCurlyInString: an engine variable reference, stored literally
const SCENE_VARIABLE = "${trigger.data.scene}";

const SCENES: ObsScene[] = [
  {
    name: "Main",
    sources: [
      { name: "Camera", sceneItemId: 1, inputKind: "v4l2_input", enabled: true },
      { name: "Mic", sceneItemId: 2, inputKind: "pulse_input_capture", enabled: true },
      { name: "Confetti", sceneItemId: 3, inputKind: "browser_source", enabled: false },
    ],
  },
  {
    name: "BRB",
    sources: [
      { name: "Mic", sceneItemId: 1, inputKind: "pulse_input_capture", enabled: true },
      { name: "Main", sceneItemId: 2, inputKind: null, enabled: true },
    ],
  },
  { name: "Empty", sources: [] },
];

function text(id: string): ConfigField {
  return { id, label: id, type: "text" };
}

describe("withObsNameSources", () => {
  test("attaches a source to the named fields of an obs action", () => {
    const fields = [
      text("sourceName"),
      { id: "visible", label: "Visible", type: "toggle" } as ConfigField,
      text("sceneName"),
    ];
    const out = withObsNameSources(fields, "obs.set_source_visibility");
    expect(out.map((f) => obsNameSourceOf(f))).toEqual([
      { kind: "obsSources", sceneField: "sceneName" },
      null,
      { kind: "obsScenes" },
    ]);
  });

  test("leaves other actions and already-sourced fields alone", () => {
    const fields = [text("sceneName")];
    expect(withObsNameSources(fields, "chat.send")).toBe(fields);
    expect(withObsNameSources(fields, undefined)).toBe(fields);
    const sourced: ConfigField = { ...text("sceneName"), source: { kind: "commands" } };
    expect(withObsNameSources([sourced], "obs.switch_scene")[0]).toBe(sourced);
  });
});

describe("obsNameGroups", () => {
  test("scenes list every scene", () => {
    expect(obsNameGroups(SCENES, { kind: "obsScenes" }, {})).toEqual([
      { heading: "Scenes", names: ["Main", "BRB", "Empty"] },
    ]);
  });

  test("sources are grouped by scene when no scene is chosen", () => {
    const groups = obsNameGroups(SCENES, { kind: "obsSources", sceneField: "sceneName" }, { sceneName: "" });
    expect(groups).toEqual([
      { heading: "Main", names: ["Camera", "Mic", "Confetti"] },
      { heading: "BRB", names: ["Mic", "Main"] },
    ]);
  });

  test("sources narrow to the chosen scene", () => {
    const groups = obsNameGroups(SCENES, { kind: "obsSources", sceneField: "sceneName" }, { sceneName: "BRB" });
    expect(groups).toEqual([{ heading: "BRB", names: ["Mic", "Main"] }]);
  });

  test("a scene built from a variable shows every scene's sources", () => {
    const groups = obsNameGroups(
      SCENES,
      { kind: "obsSources", sceneField: "sceneName" },
      { sceneName: SCENE_VARIABLE }
    );
    expect(groups).toHaveLength(2);
  });

  test("inputs put audio-only kinds first and skip nested scenes", () => {
    expect(obsNameGroups(SCENES, { kind: "obsInputs" }, {})).toEqual([
      { heading: "Audio inputs", names: ["Mic"] },
      { heading: "Other inputs", names: ["Camera", "Confetti"] },
    ]);
  });

  test("inputs with no audio-only kind are one group", () => {
    const scenes: ObsScene[] = [
      { name: "A", sources: [{ name: "Clip", sceneItemId: 1, inputKind: "ffmpeg_source", enabled: true }] },
    ];
    expect(obsNameGroups(scenes, { kind: "obsInputs" }, {})).toEqual([{ heading: "Inputs", names: ["Clip"] }]);
  });
});

describe("isAudioInputKind", () => {
  test("recognises platform audio captures", () => {
    expect(isAudioInputKind("wasapi_input_capture")).toBe(true);
    expect(isAudioInputKind("pipewire_audio_output_capture")).toBe(true);
    expect(isAudioInputKind("browser_source")).toBe(false);
  });
});

describe("obsNameMismatch", () => {
  const scenes = { kind: "obsScenes" } as const;
  const sources = { kind: "obsSources", sceneField: "sceneName" } as const;

  test("a known, blank, or variable name is not flagged", () => {
    expect(obsNameMismatch("BRB", SCENES, scenes, {})).toBeNull();
    expect(obsNameMismatch("  ", SCENES, scenes, {})).toBeNull();
    expect(obsNameMismatch(undefined, SCENES, scenes, {})).toBeNull();
    expect(obsNameMismatch(SCENE_VARIABLE, SCENES, scenes, {})).toBeNull();
  });

  test("a name differing only in case names what OBS has", () => {
    expect(obsNameMismatch("brb", SCENES, scenes, {})).toContain('OBS calls this "BRB"');
  });

  test("an unknown scene is flagged", () => {
    expect(obsNameMismatch("Starting", SCENES, scenes, {})).toBe('OBS has no scene named "Starting".');
  });

  test("a source is checked against its chosen scene", () => {
    expect(obsNameMismatch("Camera", SCENES, sources, { sceneName: "Main" })).toBeNull();
    expect(obsNameMismatch("Camera", SCENES, sources, { sceneName: "BRB" })).toBe(
      'Scene "BRB" has no source named "Camera".'
    );
    expect(obsNameMismatch("Camera", SCENES, sources, {})).toBeNull();
    expect(obsNameMismatch("Webcam", SCENES, sources, {})).toBe('No OBS scene has a source named "Webcam".');
  });

  test("an unknown input says global audio devices are not listed", () => {
    expect(obsNameMismatch("Desktop Audio", SCENES, { kind: "obsInputs" }, {})).toContain(
      "Global audio devices such as Desktop Audio are not listed"
    );
  });
});
