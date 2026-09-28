import { describe, expect, test } from "bun:test";
import type { ObsScene, ObsSceneSource } from "@convex/lib/obsScenes";
import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  isAudioInputKind,
  liveSceneNote,
  obsNameGroups,
  obsNameMismatch,
  obsNameOptionLabel,
  obsNameSourceOf,
  withObsNameSources,
} from "./obs-name-fields";

// biome-ignore lint/suspicious/noTemplateCurlyInString: an engine variable reference, stored literally
const SCENE_VARIABLE = "${trigger.data.scene}";

function item(name: string, inputKind: string | null, group: string | null = null): ObsSceneSource {
  return { name, sceneItemId: 1, inputKind, enabled: true, group };
}

const SCENES: ObsScene[] = [
  {
    name: "Main",
    sources: [
      item("Camera", "v4l2_input"),
      item("Mic", "pulse_input_capture"),
      item("Alerts", null),
      item("Confetti", "browser_source", "Alerts"),
    ],
  },
  {
    name: "BRB",
    sources: [item("Mic", "pulse_input_capture"), item("Main", null)],
  },
  { name: "Empty", sources: [] },
];

const SOURCES = { kind: "obsSources", sceneField: "sceneName" } as const;

function names(groups: ReturnType<typeof obsNameGroups>): Array<{ heading: string; names: string[] }> {
  return groups.map((g) => ({ heading: g.heading, names: g.options.map(obsNameOptionLabel) }));
}

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
    expect(out.map((f) => obsNameSourceOf(f))).toEqual([SOURCES, null, { kind: "obsScenes" }]);
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
    expect(names(obsNameGroups(SCENES, { kind: "obsScenes" }, {}))).toEqual([
      { heading: "Scenes", names: ["Main", "BRB", "Empty"] },
    ]);
  });

  test("sources are grouped by scene when no scene is chosen, group children after their group", () => {
    expect(names(obsNameGroups(SCENES, SOURCES, { sceneName: "" }))).toEqual([
      { heading: "Main", names: ["Camera", "Mic", "Alerts", "Alerts › Confetti"] },
      { heading: "BRB", names: ["Mic", "Main"] },
    ]);
  });

  test("sources narrow to the chosen scene, matched exactly", () => {
    expect(names(obsNameGroups(SCENES, SOURCES, { sceneName: "BRB" }))).toEqual([
      { heading: "BRB", names: ["Mic", "Main"] },
    ]);
    expect(obsNameGroups(SCENES, SOURCES, { sceneName: "BRB " })).toHaveLength(2);
  });

  test("a scene built from a variable shows every scene's sources", () => {
    expect(obsNameGroups(SCENES, SOURCES, { sceneName: SCENE_VARIABLE })).toHaveLength(2);
  });

  test("inputs put audio-only kinds first and skip nested scenes and groups", () => {
    expect(names(obsNameGroups(SCENES, { kind: "obsInputs" }, {}))).toEqual([
      { heading: "Audio inputs", names: ["Mic"] },
      { heading: "Other inputs", names: ["Camera", "Confetti"] },
    ]);
  });

  test("inputs with no audio-only kind are one group", () => {
    const scenes: ObsScene[] = [{ name: "A", sources: [item("Clip", "ffmpeg_source")] }];
    expect(names(obsNameGroups(scenes, { kind: "obsInputs" }, {}))).toEqual([{ heading: "Inputs", names: ["Clip"] }]);
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

  test("a known, empty, or variable name is not flagged", () => {
    expect(obsNameMismatch("BRB", SCENES, scenes, {})).toBeNull();
    expect(obsNameMismatch("", SCENES, scenes, {})).toBeNull();
    expect(obsNameMismatch(undefined, SCENES, scenes, {})).toBeNull();
    expect(obsNameMismatch(SCENE_VARIABLE, SCENES, scenes, {})).toBeNull();
  });

  test("spaces at either end are flagged, since OBS gets the name as typed", () => {
    expect(obsNameMismatch("BRB ", SCENES, scenes, {})).toContain(`will not match OBS's "BRB"`);
    expect(obsNameMismatch("  ", SCENES, scenes, {})).toContain("space at the start or end");
  });

  test("a name differing only in case names what OBS has", () => {
    expect(obsNameMismatch("brb", SCENES, scenes, {})).toContain('OBS calls this "BRB"');
  });

  test("an unknown scene is flagged", () => {
    expect(obsNameMismatch("Starting", SCENES, scenes, {})).toBe('OBS has no scene named "Starting".');
  });

  test("a source is checked against its chosen scene", () => {
    expect(obsNameMismatch("Camera", SCENES, SOURCES, { sceneName: "Main" })).toBeNull();
    expect(obsNameMismatch("Confetti", SCENES, SOURCES, { sceneName: "Main" })).toBeNull();
    expect(obsNameMismatch("Camera", SCENES, SOURCES, { sceneName: "BRB" })).toBe(
      'Scene "BRB" has no source named "Camera".'
    );
    expect(obsNameMismatch("Camera", SCENES, SOURCES, {})).toBeNull();
    expect(obsNameMismatch("Webcam", SCENES, SOURCES, {})).toBe('No OBS scene has a source named "Webcam".');
  });

  test("an unknown input says global audio devices are not listed", () => {
    expect(obsNameMismatch("Desktop Audio", SCENES, { kind: "obsInputs" }, {})).toContain(
      "Global audio devices such as Desktop Audio are not listed"
    );
  });
});

describe("liveSceneNote", () => {
  test("names the scenes holding a source when the scene is blank", () => {
    expect(liveSceneNote("Camera", SCENES, SOURCES, { sceneName: "" })).toBe(
      'A blank scene means whichever scene is live; "Camera" is only in "Main".'
    );
    expect(liveSceneNote("Mic", SCENES, SOURCES, {})).toBe(
      'A blank scene means whichever scene is live; "Mic" is only in "Main", "BRB".'
    );
  });

  test("says nothing when the scene is set, or the source is everywhere or nowhere", () => {
    expect(liveSceneNote("Camera", SCENES, SOURCES, { sceneName: "Main" })).toBeNull();
    expect(liveSceneNote("Webcam", SCENES, SOURCES, {})).toBeNull();
    const everywhere: ObsScene[] = [
      { name: "A", sources: [item("Cam", "v4l2_input")] },
      { name: "B", sources: [item("Cam", "v4l2_input")] },
    ];
    expect(liveSceneNote("Cam", everywhere, SOURCES, {})).toBeNull();
    expect(liveSceneNote("Camera", SCENES, { kind: "obsScenes" }, {})).toBeNull();
  });
});
