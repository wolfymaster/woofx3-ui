/**
 * The engine's config bundle API as the UI sees it: back up, move or share a
 * creator's workflows, chat commands, command groups and module resources as
 * one JSON file.
 *
 * The option, plan and result shapes below must match
 * `shared/clients/typescript/api/config-bundle.ts` in woofx3 (format and import
 * rules: docs/services/config-bundles.md there). The bundle itself is never
 * parsed here: it travels as the file's raw text, the engine validates it, and
 * Convex could not hold it as a value anyway, because a workflow definition may
 * carry `$`-prefixed keys that Convex rejects.
 */

/** The parts of a configuration a bundle can carry. */
export const CONFIG_SECTIONS = ["workflows", "commands", "groups", "resources"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

/**
 * The largest bundle the engine accepts. Checked in the browser before upload
 * and again in the action, so an oversized file is refused before it costs an
 * engine round trip. Well under Convex's 16 MiB argument limit for actions in
 * the default runtime; a `"use node"` action would allow only 5 MiB in total.
 */
export const CONFIG_BUNDLE_MAX_BYTES = 5 * 1024 * 1024;

export const CONFIG_CONFLICT_POLICIES = ["skip", "rename", "overwrite"] as const;
export type ConfigConflictPolicy = (typeof CONFIG_CONFLICT_POLICIES)[number];

export interface ConfigExportOptions {
  include?: ConfigSection[];
  includeMembers?: boolean;
}

export interface ConfigImportOptions {
  onConflict?: ConfigConflictPolicy;
  include?: ConfigSection[];
}

export interface ConfigBundleRequirement {
  moduleId: string;
  version: string;
}

export type ConfigItemKind = "workflow" | "command" | "group" | "resource";

export type ConfigImportAction = "create" | "update" | "skip" | "conflict";

export type ConfigImportReasonCode =
  | "identical"
  | "name_collision"
  | "renamed"
  | "overwrite"
  | "not_owned"
  | "missing_module"
  | "module_version_mismatch"
  | "unknown_resource_kind"
  | "unknown_action"
  | "unknown_group"
  | "unknown_workflow"
  | "invalid";

export interface ConfigImportReason {
  code: ConfigImportReasonCode;
  message: string;
  blocking: boolean;
}

export interface ConfigImportPlanItem {
  kind: ConfigItemKind;
  key: string;
  action: ConfigImportAction;
  targetName: string;
  targetId?: string;
  reasons: ConfigImportReason[];
}

export interface ConfigImportPlan {
  onConflict: ConfigConflictPolicy;
  items: ConfigImportPlanItem[];
  summary: Record<ConfigImportAction, number>;
  missingModules: ConfigBundleRequirement[];
}

export type ConfigImportOutcome = "created" | "updated" | "skipped" | "conflict" | "failed";

export interface ConfigImportResultItem {
  kind: ConfigItemKind;
  key: string;
  action: ConfigImportAction;
  outcome: ConfigImportOutcome;
  name?: string;
  id?: string;
  error?: string;
}

export interface ConfigImportResult {
  items: ConfigImportResultItem[];
  summary: Record<ConfigImportOutcome, number>;
}

/**
 * The engine methods this feature calls. `previewImport` and `importConfig`
 * accept the bundle as its raw text as well as decoded, so the file's text is
 * passed through untouched.
 */
export interface ConfigBundleEngineApi {
  exportConfig(options?: ConfigExportOptions): Promise<unknown>;
  previewImport(bundle: string, options?: ConfigImportOptions): Promise<ConfigImportPlan>;
  importConfig(bundle: string, options?: ConfigImportOptions): Promise<ConfigImportResult>;
}

export type InstanceRole = "owner" | "admin" | "member";

export interface ConfigBackupAccess {
  canExport: boolean;
  /** Group members and per-user command grants are other people's usernames. */
  canExportMembers: boolean;
  canImport: boolean;
}

/**
 * Any member may export: a bundle holds no secrets, tokens or module settings,
 * only configuration every member can already read in the UI. Usernames and
 * import stay with owners and admins, since import rewrites configuration in
 * bulk and member lists are personal data.
 */
export function configBackupAccess(role: InstanceRole | null): ConfigBackupAccess {
  if (role === null) {
    return { canExport: false, canExportMembers: false, canImport: false };
  }
  const manages = role === "owner" || role === "admin";
  return { canExport: true, canExportMembers: manages, canImport: manages };
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * UTF-16 code units per chunk. At most three UTF-8 bytes per code unit keeps a
 * chunk under 768 KiB, below the 1 MB Convex allows a single string value, so a
 * 5 MiB bundle crosses the Convex boundary as a handful of strings.
 */
export const CONFIG_BUNDLE_CHUNK_UNITS = 256 * 1024;

/**
 * Splits `text` into strings of at most `chunkUnits` code units, never between
 * the two halves of a surrogate pair: a lone surrogate is not valid Unicode,
 * and Convex refuses a string that contains one.
 */
export function chunkText(text: string, chunkUnits: number = CONFIG_BUNDLE_CHUNK_UNITS): string[] {
  if (!Number.isInteger(chunkUnits) || chunkUnits < 2) {
    throw new Error(`chunkText: chunkUnits must be an integer of at least 2, got ${chunkUnits}`);
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkUnits, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}
