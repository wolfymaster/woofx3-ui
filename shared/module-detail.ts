import { type ConfigField, LIST_ITEM_FIELD_TYPES, parseFieldList } from "@woofx3/api/ui-schema";
import { type LocalEndpointSummary, localEndpointSummaries } from "./local-endpoints";
import {
  installedFunctionSummaries,
  type ModuleFunctionSummary,
  marketplaceFunctionSummaries,
  type RegisteredFunction,
} from "./module-function-summary";
import { moduleOAuthIntegrationIds } from "./module-oauth";
import { parseManifestPermissions } from "./module-permissions";
import { type ManifestResourceKind, parseManifestResourceKinds } from "./resource-kinds";

// A module's detail, built from its manifest, what it registered on the
// engine and its marketplace listing. The Convex action and the direct
// gateway gather those differently and build the detail here.

export type ManifestSettingAction =
  | { kind: "internal"; request: { event: string; payload?: Record<string, unknown> }; timeoutMs?: number }
  | {
      kind: "integration";
      integration: string;
      /**
       * Whether the manifest declares the integration under `oauth[]`, the
       * only integrations a button can connect (moduleOAuth.ts).
       */
      declared: boolean;
    };

export interface ManifestSettingField {
  id: string;
  label: string;
  description: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  /** Present only when `type === "button"`. */
  action?: ManifestSettingAction;
  /** Present only when `type === "resource_ref"`: the kind of instance it links. */
  resourceKind?: string;
  /**
   * Present only when `type === "list"`: the fields of one row. The value is
   * stored as a JSON array of objects keyed by these fields' ids.
   */
  itemFields?: ConfigField[];
}

export type { ManifestResourceKind, ModuleFunctionSummary };

export interface ModuleDetailResult<ModuleRef = string> {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Latest version available in the marketplace, when the module is published there. */
  latestVersion?: string;
  author: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  readme?: string;
  isInstalled: boolean;
  triggers: Array<{ key: string; name: string; description: string; color: string }>;
  actions: Array<{ key: string; name: string; description: string; color: string }>;
  functions: ModuleFunctionSummary[];
  widgets: Array<{ slug: string; name: string }>;
  workflows: Array<{ slug: string; name: string }>;
  /** The gateway's id of the installed module, only present for installed modules. */
  moduleDbId?: ModuleRef;
  /** Module-level settings declared in the manifest. */
  manifestSettings: ManifestSettingField[];
  /** Runtime instance types declared in the manifest. */
  manifestResourceKinds: ManifestResourceKind[];
  /**
   * Permission ids the manifest of `version` declares. Null when they could not
   * be read (an installed row with no stored manifest, or an unreachable
   * marketplace archive).
   */
  permissions: string[] | null;
  /**
   * Permission ids `latestVersion` declares, read from its marketplace archive.
   * Present only for an installed module whose marketplace version differs from
   * the installed one; null when that archive could not be read.
   */
  latestPermissions?: string[] | null;
  /** What the manifest of `version` reaches on the streamer's network (`local[]`); null when unreadable, like `permissions`. */
  localEndpoints: LocalEndpointSummary[] | null;
  /** `local[]` of `latestVersion`, alongside `latestPermissions`. */
  latestLocalEndpoints?: LocalEndpointSummary[] | null;
}

export interface ManifestDeclarations {
  permissions: string[] | null;
  localEndpoints: LocalEndpointSummary[] | null;
}

export function manifestDeclarations(manifest: unknown): ManifestDeclarations {
  if (manifest === null) {
    return { permissions: null, localEndpoints: null };
  }
  return { permissions: parseManifestPermissions(manifest), localEndpoints: localEndpointSummaries(manifest) };
}

function parseManifestSettingAction(value: unknown, oauthIntegrations: string[]): ManifestSettingAction | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  if (o.kind === "integration" && typeof o.integration === "string") {
    return {
      kind: "integration",
      integration: o.integration,
      declared: oauthIntegrations.includes(o.integration),
    };
  }
  if (o.kind === "internal" && o.request && typeof o.request === "object") {
    const req = o.request as Record<string, unknown>;
    if (typeof req.event !== "string") {
      return undefined;
    }
    return {
      kind: "internal",
      request: {
        event: req.event,
        ...(req.payload && typeof req.payload === "object" ? { payload: req.payload as Record<string, unknown> } : {}),
      },
      ...(typeof o.timeoutMs === "number" ? { timeoutMs: o.timeoutMs } : {}),
    };
  }
  return undefined;
}

/**
 * A `list` setting's row fields, through the same parser every other `list`
 * control's go through, so the settings pane and the engine agree on which
 * row types render. `undefined` when none do: a list whose rows hold nothing
 * renderable is a half-built control and is left out.
 */
function parseSettingItemFields(raw: unknown): ConfigField[] | undefined {
  const fields = parseFieldList(JSON.stringify(Array.isArray(raw) ? raw : [])).filter((item) =>
    (LIST_ITEM_FIELD_TYPES as readonly string[]).includes(item.type)
  );
  return fields.length > 0 ? fields : undefined;
}

export function parseManifestSettings(manifest: unknown): ManifestSettingField[] {
  const raw = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>) : {};
  const oauthIntegrations = moduleOAuthIntegrationIds(manifest);
  return asArr(raw.settings)
    .map((s) => {
      const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      const action = parseManifestSettingAction(o.action, oauthIntegrations);
      const itemFields = o.type === "list" ? parseSettingItemFields(o.itemFields) : undefined;
      return {
        id: asStr(o.id),
        label: asStr(o.label),
        description: asStr(o.description),
        type: asStr(o.type, "string"),
        required: typeof o.required === "boolean" ? o.required : false,
        ...(o.defaultValue !== undefined ? { defaultValue: String(o.defaultValue) } : {}),
        ...(action ? { action } : {}),
        ...(typeof o.resourceKind === "string" && o.resourceKind !== "" ? { resourceKind: o.resourceKind } : {}),
        ...(itemFields ? { itemFields } : {}),
      };
    })
    .filter((s) => s.id && (s.type !== "list" || s.itemFields));
}

/** An installed module as a gateway knows it, for `installedDetail`. */
export interface InstalledModuleFacts<ModuleRef> {
  /** What the module reads as on the marketplace: its listing, or its manifest id. */
  listingId: string;
  moduleRef: ModuleRef;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  tags: string[];
  isInstalled: boolean;
}

interface RegisteredDefinition {
  slug: string;
  name: string;
  description: string;
  color: string;
}

/**
 * The detail of an installed module: what it registered on the engine, and
 * what its manifest declares. The manifest is the authority for workflows
 * too, but the declared workflows come from its marketplace listing
 * (`applyMarketplaceMetadata`), the only source that names them.
 */
export function installedDetail<ModuleRef>(
  module: InstalledModuleFacts<ModuleRef>,
  triggers: readonly RegisteredDefinition[],
  actions: readonly RegisteredDefinition[],
  functions: RegisteredFunction[],
  widgets: ReadonlyArray<{ widgetId: string; name: string }>,
  manifest: unknown
): ModuleDetailResult<ModuleRef> {
  const readable = manifest !== undefined && manifest !== null;
  return {
    id: module.listingId,
    name: module.name,
    description: module.description,
    version: module.version,
    author: module.author ?? "",
    category: module.category ?? "Utilities",
    tags: module.tags,
    isInstalled: module.isInstalled,
    moduleDbId: module.moduleRef,
    manifestSettings: parseManifestSettings(manifest),
    manifestResourceKinds: parseManifestResourceKinds(manifest),
    permissions: readable ? parseManifestPermissions(manifest) : null,
    localEndpoints: readable ? localEndpointSummaries(manifest) : null,
    triggers: triggers.map((t) => ({ key: t.slug, name: t.name, description: t.description, color: t.color })),
    actions: actions.map((a) => ({ key: a.slug, name: a.name, description: a.description, color: a.color })),
    functions: installedFunctionSummaries(functions, manifest),
    widgets: widgets.map((w) => ({ slug: w.widgetId, name: w.name })),
    workflows: [],
  };
}

export interface MarketplaceMergeData {
  readme?: string;
  iconUrl?: string;
  latestVersion?: string;
  // Workflows are declared in the manifest, not synced to the Convex workflows table, so the
  // marketplace manifest is the only source for an installed module's declared workflows.
  workflows: Array<{ slug: string; name: string }>;
}

/** What an installed module's detail takes from its marketplace listing (`GET /modules/{id}`). */
export function marketplaceMetadataOf(payload: unknown): MarketplaceMergeData {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const module = raw.module && typeof raw.module === "object" ? (raw.module as Record<string, unknown>) : raw;
  const data: MarketplaceMergeData = { workflows: parseWorkflows(module.workflows) };
  if (typeof module.readme === "string") {
    data.readme = module.readme;
  }
  if (typeof module.iconUrl === "string") {
    data.iconUrl = module.iconUrl;
  }
  if (typeof module.version === "string") {
    data.latestVersion = module.version;
  }
  return data;
}

export function applyMarketplaceMetadata<ModuleRef>(
  detail: ModuleDetailResult<ModuleRef>,
  meta: MarketplaceMergeData
): void {
  if (meta.readme !== undefined) {
    detail.readme = meta.readme;
  }
  if (meta.iconUrl !== undefined && !detail.iconUrl) {
    detail.iconUrl = meta.iconUrl;
  }
  if (meta.latestVersion !== undefined) {
    detail.latestVersion = meta.latestVersion;
  }
  detail.workflows = meta.workflows;
}

function parseWorkflows(value: unknown): Array<{ slug: string; name: string }> {
  return asArr(value).map((w) => {
    const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
    return { slug: asStr(o.slug), name: asStr(o.name) };
  });
}

function asStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStrArr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A module that is not installed, from its marketplace listing and, when readable, its archive's manifest. */
export function marketplaceDetail(moduleId: string, payload: unknown, manifest: unknown): ModuleDetailResult<never> {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const module = raw.module && typeof raw.module === "object" ? (raw.module as Record<string, unknown>) : raw;

  const id = asStr(module.id, moduleId);
  const result: ModuleDetailResult<never> = {
    id,
    name: asStr(module.name, moduleId),
    description: asStr(module.description),
    version: asStr(module.version, "0.0.0"),
    author: asStr(module.author),
    category: asStr(module.category, "Utilities"),
    tags: asStrArr(module.tags),
    isInstalled: false,
    manifestSettings: [],
    manifestResourceKinds: [],
    permissions: null,
    localEndpoints: null,
    triggers: asArr(module.triggers).map((t) => {
      const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      return {
        key: asStr(o.slug),
        name: asStr(o.name),
        description: asStr(o.description),
        color: asStr(o.color, "#6366f1"),
      };
    }),
    actions: asArr(module.actions).map((a) => {
      const o = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
      return {
        key: asStr(o.slug),
        name: asStr(o.name),
        description: asStr(o.description),
        color: asStr(o.color, "#6366f1"),
      };
    }),
    functions: marketplaceFunctionSummaries(id, asArr(module.functions), manifest),
    widgets: asArr(module.widgets).map((w) => {
      const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
      return { slug: asStr(o.slug), name: asStr(o.name) };
    }),
    workflows: parseWorkflows(module.workflows),
  };

  if (typeof module.iconUrl === "string") {
    result.iconUrl = module.iconUrl;
  }
  if (typeof module.readme === "string") {
    result.readme = module.readme;
  }
  return result;
}
