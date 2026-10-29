import { type KindDeclarer, manifestModuleName, parseManifestResourceKinds } from "@shared/resource-kinds";
import type { EngineModuleSummary, ResourceInstanceDefinition } from "@woofx3/api";
import type { ModuleResourceInstance } from "@/engine/types";
import { toModuleId } from "../ids";

export function toModuleResourceInstance(instance: ResourceInstanceDefinition): ModuleResourceInstance {
  return {
    canonicalId: instance.canonicalId,
    engineInstanceId: instance.id,
    resourceInstanceId: instance.instanceId,
    kind: instance.kind,
    moduleId: toModuleId(instance.moduleName),
    moduleName: instance.moduleName,
    displayName: instance.displayName,
    settings: instance.settings ?? {},
  };
}

/**
 * The kinds each installed module's manifest declares, one entry per module,
 * read as the Convex mirror reads its module rows: a module is named by its
 * manifest's id, or its manifest id on the engine when the manifest names none.
 */
export function toKindDeclarers(modules: readonly EngineModuleSummary[]): KindDeclarer[] {
  const declarers = new Map<string, KindDeclarer>();
  for (const module of modules) {
    const moduleName = manifestModuleName(module.manifest, module.moduleId);
    if (!declarers.has(moduleName)) {
      declarers.set(moduleName, { moduleName, kinds: parseManifestResourceKinds(module.manifest) });
    }
  }
  return [...declarers.values()];
}
