import { actionDefinitionRow, triggerDefinitionRow } from "@shared/definition-rows";
import type { LocalEndpointSummary, LocalProtocol } from "@shared/local-endpoints";
import { installedDetail, type ModuleDetailResult } from "@shared/module-detail";
import { bareModuleKey } from "@shared/module-key";
import type {
  AvailableFunction,
  EngineModuleSummary,
  MarketplaceListingInspection,
  ModuleSetting,
  Woofx3EngineApi,
} from "@woofx3/api";
import type { InstalledModule, ModuleDetail, ModuleId, ModuleProvenance, ModuleSettingValue } from "@/engine/types";
import { toModuleId } from "../ids";

type WorkflowCatalogAnswer = Awaited<ReturnType<Woofx3EngineApi["getWorkflowCatalog"]>>;
type AvailableWidget = Awaited<ReturnType<Woofx3EngineApi["getAvailableWidgets"]>>["widgets"][number];

/** What the engine registered for every module, read once for one module's detail. */
export interface EngineRegistrations {
  catalog: WorkflowCatalogAnswer;
  functions: readonly AvailableFunction[];
  widgets: readonly AvailableWidget[];
}

/**
 * Whether `summary` is the module `moduleId` names: its manifest id, or the
 * marketplace listing it came from, the two ids a detail page is opened by.
 */
export function isModuleNamed(summary: EngineModuleSummary, moduleId: string): boolean {
  return summary.moduleId === moduleId || summary.marketplaceListingId === moduleId;
}

function manifestField(manifest: Record<string, unknown> | null, field: string): unknown {
  return manifest === null ? undefined : manifest[field];
}

function manifestString(manifest: Record<string, unknown> | null, field: string): string | undefined {
  const value = manifestField(manifest, field);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function manifestStrings(manifest: Record<string, unknown> | null, field: string): string[] {
  const value = manifestField(manifest, field);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Catalog declarations name themselves by `id`; the module detail readers key them by `slug`. */
function slugged(items: unknown): Record<string, unknown>[] {
  return Array.isArray(items) ? items.map((item) => ({ ...record(item), slug: record(item).id })) : [];
}

/**
 * The marketplace module record the shared detail readers take
 * (`marketplaceDetail`, `marketplaceMetadataOf`), from the engine's
 * `marketplaceGetListing` answer. That answer is the catalog's
 * `{listing}`, which keeps the listing's own fields at its top and what the
 * module declares under `listing.module`; the readers want both in one record.
 */
export function catalogModuleRecord(payload: unknown): { module: Record<string, unknown> } {
  const listing = record(record(payload).listing);
  const declared = record(listing.module);
  return {
    module: {
      id: listing.id,
      name: listing.name,
      description: listing.description,
      version: listing.version,
      author: listing.author,
      category: listing.category,
      tags: listing.tags,
      readme: declared.readme,
      triggers: slugged(declared.triggers),
      actions: slugged(declared.actions),
      functions: declared.functions,
      widgets: slugged(declared.widgets),
    },
  };
}

/** The engine's value of `createdByType` for a module that ships with it. */
const BUILT_IN_CREATOR = "SYSTEM";

function summaryProvenance(summary: EngineModuleSummary): ModuleProvenance | null {
  if (summary.createdByType === BUILT_IN_CREATOR) {
    return "builtIn";
  }
  if (summary.marketplaceListingId) {
    return "marketplace";
  }
  return summary.uploadResourceId ? "uploaded" : null;
}

/** Every module the engine lists is one it has installed; it lists nothing mid-install. */
export function toInstalledModule(summary: EngineModuleSummary): InstalledModule {
  const manifest = summary.manifest;
  return {
    id: toModuleId(summary.moduleId),
    name: summary.name,
    description: manifestString(manifest, "description") ?? "",
    version: summary.version,
    tags: manifestStrings(manifest, "tags"),
    author: manifestString(manifest, "author"),
    category: manifestString(manifest, "category"),
    moduleKey: summary.moduleKey,
    status: "installed",
    provenance: summaryProvenance(summary),
    marketplaceListingId: summary.marketplaceListingId,
    marketplaceEdition: summary.marketplaceEdition,
    manifest,
  };
}

/**
 * An installed module's detail from the engine alone. Definitions belong to
 * the module whose manifest id leads their `createdByRef`; functions name
 * their module by its display name, the only module field they carry.
 */
export function toInstalledModuleDetail(
  summary: EngineModuleSummary,
  registrations: EngineRegistrations
): ModuleDetailResult<ModuleId> {
  const owns = (definition: { createdByRef?: string }) => bareModuleKey(definition.createdByRef) === summary.moduleId;
  const manifest = summary.manifest;
  return installedDetail(
    {
      listingId: summary.marketplaceListingId ?? summary.moduleId,
      moduleRef: toModuleId(summary.moduleId),
      name: summary.name,
      description: manifestString(manifest, "description") ?? "",
      version: summary.version,
      author: manifestString(manifest, "author"),
      category: manifestString(manifest, "category"),
      tags: manifestStrings(manifest, "tags"),
      isInstalled: true,
    },
    registrations.catalog.triggers.filter(owns).map((t) => triggerDefinitionRow(t, summary.moduleId)),
    registrations.catalog.actions.filter(owns).map((a) => actionDefinitionRow(a, summary.moduleId)),
    registrations.functions
      .filter((f) => f.moduleName === summary.name)
      .map((f) => ({
        qualifiedName: f.qualifiedName,
        manifestId: f.manifestId,
        functionName: f.name,
        fileName: "",
        entryPoint: "",
        runtime: f.runtime,
      })),
    registrations.widgets.filter(owns).map((w) => ({ widgetId: w.id, name: w.name })),
    manifest
  );
}

const LOCAL_PROTOCOLS: ReadonlySet<string> = new Set<LocalProtocol>(["websocket", "http"]);

/**
 * The local endpoints an inspection reports, kept to the protocols this
 * dashboard knows; the engine validated every entry at publish.
 */
export function inspectionLocalEndpoints(inspection: MarketplaceListingInspection): LocalEndpointSummary[] {
  return inspection.localEndpoints
    .filter((endpoint) => LOCAL_PROTOCOLS.has(endpoint.protocol))
    .map((endpoint) => ({ id: endpoint.id, name: endpoint.name, protocol: endpoint.protocol as LocalProtocol }));
}

export function toModuleDetail(result: ModuleDetailResult<ModuleId>): ModuleDetail {
  return { ...result };
}

export function toModuleSettingValue(setting: ModuleSetting): ModuleSettingValue {
  return {
    id: setting.id,
    moduleId: setting.moduleId,
    key: setting.key,
    value: setting.value,
    valueType: setting.valueType,
    ...(setting.isSet !== undefined ? { isSet: setting.isSet } : {}),
  };
}
