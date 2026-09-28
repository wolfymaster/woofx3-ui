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

/** One name offered by the picker; `group` is the OBS group it sits in, if any. */
export interface ObsNameOption {
  name: string;
  group: string | null;
}

export interface ObsNameGroup {
  heading: string;
  options: ObsNameOption[];
}

/** How the picker shows an option: a source inside a group reads "Group › Source". */
export function obsNameOptionLabel(option: ObsNameOption): string {
  return option.group === null ? option.name : `${option.group} › ${option.name}`;
}

/** Drops repeats of a name, keeping the first; OBS's order is kept. */
function uniqueByName(options: ObsNameOption[]): ObsNameOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.name)) {
      return false;
    }
    seen.add(option.name);
    return true;
  });
}

function sceneOptions(scene: ObsScene): ObsNameOption[] {
  return uniqueByName(scene.sources.map((item) => ({ name: item.name, group: item.group })));
}

/**
 * Whether a scene field's value is blank. The engine hands names to OBS
 * untouched, so only the empty string means "no scene" (whichever scene is live
 * when the step runs); a value of spaces is a name OBS will not have.
 */
function isBlankScene(sceneValue: unknown): boolean {
  return sceneValue === undefined || sceneValue === null || sceneValue === "";
}

/**
 * The scene a sources field is scoped to: the sibling scene field's value when
 * it names one of OBS's scenes exactly, else null (blank means whichever scene
 * is live when the step runs, and a variable is only known then).
 */
export function scopedScene(scenes: readonly ObsScene[], sceneValue: unknown): ObsScene | null {
  if (typeof sceneValue !== "string" || sceneValue === "" || isObsNameExpression(sceneValue)) {
    return null;
  }
  return scenes.find((scene) => scene.name === sceneValue) ?? null;
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
    const options = uniqueByName(scenes.map((scene) => ({ name: scene.name, group: null })));
    return options.length > 0 ? [{ heading: "Scenes", options }] : [];
  }

  if (source.kind === "obsSources") {
    const scene = scopedScene(scenes, values[source.sceneField]);
    const shown = scene ? [scene] : scenes;
    return shown
      .map((s) => ({ heading: s.name, options: sceneOptions(s) }))
      .filter((group) => group.options.length > 0);
  }

  const audio: ObsNameOption[] = [];
  const other: ObsNameOption[] = [];
  for (const scene of scenes) {
    for (const item of scene.sources) {
      // A null kind is a nested scene or group, which has no audio of its own.
      if (item.inputKind === null) {
        continue;
      }
      // An input's name is global in OBS, so its group in one scene says nothing useful here.
      (isAudioInputKind(item.inputKind) ? audio : other).push({ name: item.name, group: null });
    }
  }
  const audioOptions = uniqueByName(audio);
  const audioNames = new Set(audioOptions.map((option) => option.name));
  const otherOptions = uniqueByName(other).filter((option) => !audioNames.has(option.name));
  const groups: ObsNameGroup[] = [];
  if (audioOptions.length > 0) {
    groups.push({ heading: "Audio inputs", options: audioOptions });
  }
  if (otherOptions.length > 0) {
    groups.push({ heading: audioOptions.length > 0 ? "Other inputs" : "Inputs", options: otherOptions });
  }
  return groups;
}

function knownNames(groups: readonly ObsNameGroup[]): string[] {
  return groups.flatMap((group) => group.options.map((option) => option.name));
}

/**
 * Why a typed OBS name will not be found when the step runs, or null when it
 * will be (or cannot be judged yet: empty, or built from a variable). OBS
 * matches names exactly, so a name differing only in case, or carrying spaces at
 * either end, is called out with the name OBS has.
 */
export function obsNameMismatch(
  value: unknown,
  scenes: readonly ObsScene[],
  source: ObsNameSource,
  values: Readonly<Record<string, unknown>>
): string | null {
  if (typeof value !== "string" || value === "" || isObsNameExpression(value)) {
    return null;
  }
  const known = knownNames(obsNameGroups(scenes, source, values));
  if (known.includes(value)) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed !== value) {
    if (known.includes(trimmed)) {
      return `"${value}" has a space at the start or end, so it will not match OBS's "${trimmed}".`;
    }
    return `"${value}" has a space at the start or end. OBS matches names exactly, spaces included.`;
  }
  const lower = value.toLowerCase();
  const caseOnly = known.find((candidate) => candidate.toLowerCase() === lower);
  if (caseOnly !== undefined) {
    return `OBS calls this "${caseOnly}". Names are case-sensitive, so "${value}" will not match.`;
  }

  if (source.kind === "obsScenes") {
    return `OBS has no scene named "${value}".`;
  }
  if (source.kind === "obsSources") {
    const scene = scopedScene(scenes, values[source.sceneField]);
    return scene
      ? `Scene "${scene.name}" has no source named "${value}".`
      : `No OBS scene has a source named "${value}".`;
  }
  // Global audio devices set in OBS's audio settings (Desktop Audio, Mic/Aux)
  // belong to no scene, so the listing cannot show them.
  return `No OBS scene has an input named "${value}". Global audio devices such as Desktop Audio are not listed, so a name from OBS's audio mixer may still work.`;
}

/**
 * For a source named with the scene left blank: the step acts on whichever
 * scene is live when it runs, so a source that only some scenes hold fails in
 * the others. Null when the scene is set, or the source is in every scene, or
 * is not in any (obsNameMismatch speaks for that).
 */
export function liveSceneNote(
  value: unknown,
  scenes: readonly ObsScene[],
  source: ObsNameSource,
  values: Readonly<Record<string, unknown>>
): string | null {
  if (source.kind !== "obsSources" || !isBlankScene(values[source.sceneField])) {
    return null;
  }
  if (typeof value !== "string" || value === "" || isObsNameExpression(value)) {
    return null;
  }
  const holding = scenes.filter((scene) => scene.sources.some((item) => item.name === value));
  if (holding.length === 0 || holding.length === scenes.length) {
    return null;
  }
  const names = holding.map((scene) => `"${scene.name}"`).join(", ");
  return `A blank scene means whichever scene is live; "${value}" is only in ${names}.`;
}
