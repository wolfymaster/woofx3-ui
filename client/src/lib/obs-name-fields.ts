import type { ObsScene } from "@convex/lib/obsScenes";
import type { ConfigField, ConfigFieldSource } from "@woofx3/api/ui-schema";

/**
 * Where an OBS name field draws the names it offers: OBS's scenes, the sources
 * placed in a scene (the scene named by the sibling field `sceneField`, or every
 * scene when that is blank), or the inputs placed in any scene.
 */
export type ObsNameSource = { kind: "obsScenes" } | { kind: "obsSources"; sceneField: string } | { kind: "obsInputs" };

/**
 * The fields of the engine's native `obs.*` actions that name something in OBS,
 * keyed by action id and then field id. Must match the `schema` of those
 * actions in modules/woofx3/manifest.json in the engine.
 *
 * The manifest declares these as plain text fields because ConfigFieldSource
 * has no OBS kind. The lasting design is for the manifest to declare
 * `source: { kind: "obsScenes" }` (and its siblings) on the field itself, parsed
 * like any other source; this table stands in for that declaration and goes
 * away once it exists.
 */
const OBS_NAME_FIELDS: Readonly<Record<string, Readonly<Record<string, ObsNameSource>>>> = {
  "obs.switch_scene": {
    sceneName: { kind: "obsScenes" },
  },
  "obs.set_source_visibility": {
    sceneName: { kind: "obsScenes" },
    sourceName: { kind: "obsSources", sceneField: "sceneName" },
  },
  "obs.set_input_mute": {
    inputName: { kind: "obsInputs" },
  },
};

/**
 * Attach an OBS name source to each field of `actionId` the table names, so
 * ConfigurationForm renders it with the `source:<kind>` picker. A field that is
 * not text, or already declares a source, is left alone: the manifest's own
 * declaration wins over this table.
 */
export function withObsNameSources(fields: ConfigField[], actionId: string | undefined): ConfigField[] {
  const byField = actionId ? OBS_NAME_FIELDS[actionId] : undefined;
  if (!byField) {
    return fields;
  }
  return fields.map((field) => {
    const source = byField[field.id];
    if (!source || field.type !== "text" || field.source) {
      return field;
    }
    // ConfigFieldSource has no OBS kind yet (see OBS_NAME_FIELDS); the form
    // reads `source.kind` structurally, so the value is carried as is.
    return { ...field, source: source as unknown as ConfigFieldSource };
  });
}

/** The OBS name source a field carries, or null when it carries none. */
export function obsNameSourceOf(field: object): ObsNameSource | null {
  const source = (field as { source?: unknown }).source;
  if (!source || typeof source !== "object") {
    return null;
  }
  const o = source as Record<string, unknown>;
  if (o.kind === "obsScenes" || o.kind === "obsInputs") {
    return { kind: o.kind };
  }
  if (o.kind === "obsSources" && typeof o.sceneField === "string") {
    return { kind: "obsSources", sceneField: o.sceneField };
  }
  return null;
}

/** A value built from a workflow variable is only known when the step runs. */
export function isObsNameExpression(value: string): boolean {
  return value.includes("${");
}

/**
 * Input kinds that only carry audio, across OBS's platforms. Other inputs (media,
 * browser, video capture) can carry audio too, so they are offered after these
 * rather than hidden.
 */
const AUDIO_INPUT_KINDS: ReadonlySet<string> = new Set([
  "wasapi_input_capture",
  "wasapi_output_capture",
  "wasapi_process_output_capture",
  "pulse_input_capture",
  "pulse_output_capture",
  "alsa_input_capture",
  "jack_input_client",
  "jack_output_client",
  "coreaudio_input_capture",
  "coreaudio_output_capture",
  "sck_audio_capture",
]);

export function isAudioInputKind(inputKind: string): boolean {
  return AUDIO_INPUT_KINDS.has(inputKind) || inputKind.includes("audio");
}

export interface ObsNameGroup {
  heading: string;
  names: string[];
}

function unique(names: string[]): string[] {
  return Array.from(new Set(names));
}

/**
 * The scene a sources field is scoped to: the sibling scene field's value when
 * it names one of OBS's scenes exactly, else null (blank means whichever scene
 * is live when the step runs, and a variable is only known then).
 */
export function scopedScene(scenes: readonly ObsScene[], sceneValue: unknown): ObsScene | null {
  if (typeof sceneValue !== "string") {
    return null;
  }
  const name = sceneValue.trim();
  if (name === "" || isObsNameExpression(name)) {
    return null;
  }
  return scenes.find((scene) => scene.name === name) ?? null;
}

/**
 * The names an OBS name field offers, grouped for the picker. `values` are the
 * form's current values, for a sources field scoped by its scene field.
 */
export function obsNameGroups(
  scenes: readonly ObsScene[],
  source: ObsNameSource,
  values: Readonly<Record<string, unknown>>
): ObsNameGroup[] {
  if (source.kind === "obsScenes") {
    return scenes.length > 0 ? [{ heading: "Scenes", names: unique(scenes.map((scene) => scene.name)) }] : [];
  }

  if (source.kind === "obsSources") {
    const scene = scopedScene(scenes, values[source.sceneField]);
    const shown = scene ? [scene] : scenes;
    return shown
      .map((s) => ({ heading: s.name, names: unique(s.sources.map((item) => item.name)) }))
      .filter((group) => group.names.length > 0);
  }

  const audio: string[] = [];
  const other: string[] = [];
  for (const scene of scenes) {
    for (const item of scene.sources) {
      // A null kind is a nested scene or group, which has no audio of its own.
      if (item.inputKind === null) {
        continue;
      }
      (isAudioInputKind(item.inputKind) ? audio : other).push(item.name);
    }
  }
  const audioNames = unique(audio);
  const otherNames = unique(other).filter((name) => !audioNames.includes(name));
  const groups: ObsNameGroup[] = [];
  if (audioNames.length > 0) {
    groups.push({ heading: "Audio inputs", names: audioNames });
  }
  if (otherNames.length > 0) {
    groups.push({ heading: audioNames.length > 0 ? "Other inputs" : "Inputs", names: otherNames });
  }
  return groups;
}

/**
 * Why a typed OBS name will not be found when the step runs, or null when it
 * will be (or cannot be judged yet: blank, or built from a variable). OBS
 * matches names case-sensitively, so a name differing only in case is called
 * out with the name OBS has.
 */
export function obsNameMismatch(
  value: unknown,
  scenes: readonly ObsScene[],
  source: ObsNameSource,
  values: Readonly<Record<string, unknown>>
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim();
  if (name === "" || isObsNameExpression(name)) {
    return null;
  }
  const known = obsNameGroups(scenes, source, values).flatMap((group) => group.names);
  if (known.includes(name)) {
    return null;
  }
  const lower = name.toLowerCase();
  const caseOnly = known.find((candidate) => candidate.toLowerCase() === lower);
  if (caseOnly !== undefined) {
    return `OBS calls this "${caseOnly}". Names are case-sensitive, so "${name}" will not match.`;
  }

  if (source.kind === "obsScenes") {
    return `OBS has no scene named "${name}".`;
  }
  if (source.kind === "obsSources") {
    const scene = scopedScene(scenes, values[source.sceneField]);
    return scene
      ? `Scene "${scene.name}" has no source named "${name}".`
      : `No OBS scene has a source named "${name}".`;
  }
  // Global audio devices set in OBS's audio settings (Desktop Audio, Mic/Aux)
  // belong to no scene, so the listing cannot show them.
  return `No OBS scene has an input named "${name}". Global audio devices such as Desktop Audio are not listed, so a name from OBS's audio mixer may still work.`;
}
