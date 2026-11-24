import { gunzipSync, strFromU8, unzipSync } from "fflate";
import type { FirebotDocument } from "./firebot";
import { asCollection, asRecord, asRecords, asString, type JsonRecord } from "./read";
import type { StreamerbotDocument } from "./streamerbot";

/**
 * Opens the files Firebot and Streamer.bot export. Runs in the browser: a
 * Firebot backup is a zip of the whole profile, sounds and overlay files
 * included, so only the JSON the import reads is taken out of it and sent on.
 */

export type ImportDocument =
  | { source: "firebot"; document: FirebotDocument }
  | { source: "streamerbot"; document: StreamerbotDocument };

/** A file that is not the export it was offered as, with a message for the streamer. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

/** "SBAE": the four bytes Streamer.bot puts before the gzip stream in an export. */
const STREAMERBOT_MAGIC = [0x53, 0x42, 0x41, 0x45];

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportFileError(`This ${what} is damaged: its contents are not readable JSON.`);
  }
}

/**
 * A Streamer.bot export string, as pasted from Import/Export or read from a
 * `.sb` file: base64 of "SBAE" followed by gzipped JSON.
 */
export function decodeStreamerbotExport(input: string, fileName = ""): StreamerbotDocument {
  const compact = input.replace(/^﻿/, "").replace(/\s+/g, "");
  if (compact === "") {
    throw new ImportFileError("Paste the export string Streamer.bot copied, or choose an exported file.");
  }
  let bytes: Uint8Array;
  try {
    bytes = base64Bytes(compact);
  } catch {
    throw new ImportFileError("That is not a Streamer.bot export string.");
  }
  if (bytes.length < 6 || STREAMERBOT_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new ImportFileError("That is not a Streamer.bot export string.");
  }
  let json: string;
  try {
    json = strFromU8(gunzipSync(bytes.subarray(STREAMERBOT_MAGIC.length)));
  } catch {
    throw new ImportFileError("This Streamer.bot export is cut short or damaged. Copy it again.");
  }
  const parsed = asRecord(parseJson(json, "Streamer.bot export"));
  if (!parsed || !asRecord(parsed.data)) {
    throw new ImportFileError("This Streamer.bot export holds no actions or commands.");
  }
  return { name: fileName.replace(/\.[^.]+$/, ""), export: parsed };
}

/** A `.firebotsetup` file: plain JSON with the setup's parts under `components`. */
export function decodeFirebotSetup(text: string, fileName = ""): FirebotDocument {
  const parsed = asRecord(parseJson(text, "Firebot setup"));
  const components = asRecord(parsed?.components);
  if (!parsed || !components) {
    throw new ImportFileError("This is not a Firebot setup file. In Firebot, use Setups > Create Setup.");
  }
  return { name: asString(parsed.name) || fileName.replace(/\.[^.]+$/, ""), components };
}

/**
 * Profile files of a Firebot backup the import reads, by their path inside the
 * profile folder. Firebot stores most collections as records keyed by id.
 */
const PROFILE_FILES = {
  commands: "chat/commands.json",
  events: "events/events.json",
  timers: "timers.json",
  scheduledTasks: "scheduled-tasks.json",
  presetEffectLists: "effects/preset-effect-lists.json",
  counters: "counters/counters.json",
  customRoles: "roles/custom-roles.json",
  legacyCustomRoles: "roles/customroles.json",
  currencies: "currency/currency.json",
  quickActions: "custom-quick-actions.json",
  hotkeys: "hotkeys.json",
  overlayWidgetConfigs: "overlay-widgets.json",
  viewerRankLadders: "ranks.json",
  variableMacros: "variable-macros.json",
} as const;

const PROFILES_SEGMENT = "profiles/";

/** The folder inside the zip that holds the profile folders, which a re-zipped backup may nest. */
function profilesRoot(names: string[]): string | null {
  for (const name of names) {
    const at = name.indexOf(PROFILES_SEGMENT);
    if (at !== -1) {
      return name.slice(0, at);
    }
  }
  return null;
}

function chooseProfile(files: Record<string, Uint8Array>, root: string): string {
  const profiles = new Set<string>();
  for (const name of Object.keys(files)) {
    if (name.startsWith(`${root}${PROFILES_SEGMENT}`)) {
      const rest = name.slice(root.length + PROFILES_SEGMENT.length);
      const profile = rest.split("/")[0];
      if (profile !== "") {
        profiles.add(profile);
      }
    }
  }
  const settingsFile = files[`${root}global-settings.json`];
  if (settingsFile) {
    const settings = asRecord(asRecord(parseJson(strFromU8(settingsFile), "Firebot backup"))?.profiles);
    const loggedIn = asString(settings?.loggedInProfile);
    if (profiles.has(loggedIn)) {
      return loggedIn;
    }
  }
  const [first] = Array.from(profiles).sort();
  if (first === undefined) {
    throw new ImportFileError("This backup has no Firebot profile in it.");
  }
  return first;
}

/**
 * A Firebot backup zip (Settings > Backups), gathered into the same shape a
 * `.firebotsetup` file has. The profile Firebot was last signed into is the one
 * imported.
 */
export function decodeFirebotBackup(zip: Uint8Array, fileName = ""): FirebotDocument {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: (file) => file.name.endsWith(".json") });
  } catch {
    throw new ImportFileError("This is not a zip file. Choose a Firebot backup from Settings > Backups.");
  }
  const root = profilesRoot(Object.keys(files));
  if (root === null) {
    throw new ImportFileError("This zip is not a Firebot backup: it has no profiles folder.");
  }
  const profile = chooseProfile(files, root);
  const read = (path: string): JsonRecord => {
    const file = files[`${root}${PROFILES_SEGMENT}${profile}/${path}`];
    return file ? (asRecord(parseJson(strFromU8(file), "Firebot backup")) ?? {}) : {};
  };

  const commands = read(PROFILE_FILES.commands);
  const events = read(PROFILE_FILES.events);
  const customRoles = read(PROFILE_FILES.customRoles);
  const components: JsonRecord = {
    commands: asCollection(commands.customCommands),
    events: asRecords(events.mainEvents),
    eventGroups: asCollection(events.groups),
    timers: asCollection(read(PROFILE_FILES.timers)),
    scheduledTasks: asCollection(read(PROFILE_FILES.scheduledTasks)),
    presetEffectLists: asCollection(read(PROFILE_FILES.presetEffectLists)),
    counters: asCollection(read(PROFILE_FILES.counters)),
    viewerRoles: asCollection(
      Object.keys(customRoles).length > 0 ? customRoles : read(PROFILE_FILES.legacyCustomRoles)
    ),
    currencies: asCollection(read(PROFILE_FILES.currencies)),
    quickActions: asCollection(read(PROFILE_FILES.quickActions)),
    hotkeys: asCollection(read(PROFILE_FILES.hotkeys)),
    overlayWidgetConfigs: asCollection(read(PROFILE_FILES.overlayWidgetConfigs)),
    viewerRankLadders: asCollection(read(PROFILE_FILES.viewerRankLadders)),
    variableMacros: asCollection(read(PROFILE_FILES.variableMacros)),
  };
  return { name: profile || fileName.replace(/\.[^.]+$/, ""), components };
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** A file chosen for a Firebot import: a setup file or a backup zip. */
export function decodeFirebotFile(fileName: string, bytes: Uint8Array): FirebotDocument {
  if (isZip(bytes)) {
    return decodeFirebotBackup(bytes, fileName);
  }
  return decodeFirebotSetup(strFromU8(bytes), fileName);
}
