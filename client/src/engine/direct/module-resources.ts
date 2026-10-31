import { unescapeDollarKeys } from "@shared/dollar-keys";
import { type KindDeclarer, parseKindRef, resolveResourceKind, rowsOfKind } from "@shared/resource-kinds";
import type { ActionStep } from "@woofx3/api";
import { useCallback } from "react";
import type { ModuleResourcesGateway } from "@/engine/gateway";
import type {
  DeclaredResourceKind,
  ModuleId,
  ModuleResourceInstance,
  ModuleResourceInstanceChanges,
  NewModuleResourceInstance,
  ResourceValues,
} from "@/engine/types";
import { fromModuleId } from "./ids";
import { directKeys as k } from "./keys";
import { toKindDeclarers, toModuleResourceInstance } from "./map/module-resources";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/** The event a dashboard's own action run carries, as the Convex gateway sends it. */
const DASHBOARD_ACTION_EVENT = { type: "dashboard.action", source: "dashboard", data: {} };

function instancesRead(runtime: DirectRuntime): EngineRead<ModuleResourceInstance[]> {
  return {
    queryKey: k.moduleResources.instances(),
    queryFn: async () =>
      (await runtime.call("listAllResourceInstances", (api) => api.listAllResourceInstances())).map(
        toModuleResourceInstance
      ),
  };
}

function kindsRead(runtime: DirectRuntime): EngineRead<KindDeclarer[]> {
  return {
    queryKey: k.moduleResources.kinds(),
    queryFn: async () => toKindDeclarers(await runtime.call("listEngineModules", (api) => api.listEngineModules())),
  };
}

/**
 * The instances of each kind in `kinds`, matched as the Convex mirror matches
 * them: a qualified kind names its module, and a bare one means the module
 * declaring it, or every module's instances of that name when that cannot be
 * told. An instance two kinds both pick is listed once; a malformed kind picks
 * nothing.
 */
function ofKindsRead(runtime: DirectRuntime, kinds: readonly string[]): EngineRead<ModuleResourceInstance[]> {
  return {
    queryKey: k.moduleResources.ofKinds(kinds),
    queryFn: async () => {
      const [instances, declarers] = await Promise.all([
        runtime.queryClient.fetchQuery(instancesRead(runtime)),
        runtime.queryClient.fetchQuery(kindsRead(runtime)),
      ]);
      const picked = new Map<string, ModuleResourceInstance>();
      for (const kind of kinds) {
        const parsed = parseKindRef(kind);
        if (!parsed) {
          continue;
        }
        const owner = parsed.module ?? resolveResourceKind(declarers, kind)?.moduleName;
        for (const instance of rowsOfKind(instances, parsed.kind, owner)) {
          picked.set(instance.canonicalId, instance);
        }
      }
      return [...picked.values()];
    },
  };
}

/** Every instance's current value, keyed by canonical id; one read for all of them. */
function valuesRead(runtime: DirectRuntime): EngineRead<ResourceValues> {
  return {
    queryKey: k.moduleResources.values(),
    queryFn: async () => {
      const instances = await runtime.queryClient.fetchQuery(instancesRead(runtime));
      if (instances.length === 0) {
        return {};
      }
      return runtime.call("getResourceValues", (api) =>
        api.getResourceValues(instances.map((instance) => instance.canonicalId))
      );
    },
  };
}

function declaredKinds(declarers: KindDeclarer[]): DeclaredResourceKind[] {
  return declarers.flatMap((declarer) =>
    declarer.kinds.map((declaration) => ({ moduleName: declarer.moduleName, ...declaration }))
  );
}

/** Kinds sorted and unique, so one set of kinds is one cache entry however a screen orders it. */
function kindsKey(kinds: readonly string[]): string[] {
  return [...new Set(kinds)].sort();
}

/**
 * Resource instances, their values and the kinds installed modules declare,
 * read from the engine and kept current by its resource instance, storage and
 * module events. Instances are read once and every narrower read selects
 * from that one entry.
 */
export function directModuleResourcesGateway(runtime: DirectRuntime): ModuleResourcesGateway {
  const invalidateAll = () => runtime.queryClient.invalidateQueries({ queryKey: k.moduleResources.all });

  const create = async ({ moduleName, kind, resourceInstanceId, displayName, settings }: NewModuleResourceInstance) => {
    const created = await runtime.call("createResourceInstance", (api) =>
      api.createResourceInstance(moduleName, kind, resourceInstanceId, displayName, settings ?? {})
    );
    await invalidateAll();
    return { canonicalId: created.canonicalId, displayName: created.displayName, instanceId: created.instanceId };
  };

  const update = async ({ canonicalId, displayName, settings }: ModuleResourceInstanceChanges) => {
    await runtime.call("updateResourceInstance", (api) =>
      api.updateResourceInstance(canonicalId, displayName, settings)
    );
    await invalidateAll();
    return null;
  };

  const remove = async (canonicalId: string) => {
    await runtime.call("deleteResourceInstance", (api) => api.deleteResourceInstance(canonicalId));
    await invalidateAll();
    return null;
  };

  // The engine lists a module's instances by its installed key, so the
  // module is found among the installed ones first.
  const syncModule = async (moduleId: ModuleId) => {
    const manifestId = fromModuleId(moduleId);
    const modules = await runtime.call("listEngineModules", (api) => api.listEngineModules());
    const module = modules.find((candidate) => candidate.moduleId === manifestId);
    if (module === undefined) {
      throw new Error(`No installed module ${JSON.stringify(manifestId)} on the engine.`);
    }
    const instances = await runtime.call("listResourceInstancesForModule", (api) =>
      api.listResourceInstancesForModule(module.moduleKey, manifestId)
    );
    await invalidateAll();
    return { itemsProcessed: instances.length };
  };

  // Values are read for every instance at once, so a kind's refresh reads them all.
  const refreshValues = async (_kind: string) => {
    await runtime.queryClient.invalidateQueries({ queryKey: k.moduleResources.values() });
    return null;
  };

  const runActions = async (label: string, actions: unknown[]) => {
    if (actions.length === 0) {
      throw new Error("There are no actions to run.");
    }
    await runtime.call("runActions", (api) =>
      api.runActions({ label, actions: unescapeDollarKeys(actions) as ActionStep[], event: DASHBOARD_ACTION_EVENT })
    );
    return null;
  };

  return {
    useInstances: () => useEngineQuery(runtime, instancesRead(runtime)),
    useModuleInstances: (moduleId) => {
      const ofModule = useCallback(
        (instances: ModuleResourceInstance[]) =>
          instances.filter((instance) => moduleId !== null && instance.moduleName === fromModuleId(moduleId)),
        [moduleId]
      );
      return useEngineQuery(runtime, instancesRead(runtime), { enabled: moduleId !== null, select: ofModule });
    },
    useKindInstances: (kind) =>
      useEngineQuery(runtime, ofKindsRead(runtime, kind === null ? [] : [kind]), { enabled: kind !== null }),
    useKindsInstances: (kinds) =>
      useEngineQuery(runtime, ofKindsRead(runtime, kindsKey(kinds)), { enabled: kinds.length > 0 }),
    useValues: () => useEngineQuery(runtime, valuesRead(runtime)),
    useKind: (kind) => {
      const resolve = useCallback(
        (declarers: KindDeclarer[]): DeclaredResourceKind | null => {
          const resolved = kind === null ? null : resolveResourceKind(declarers, kind);
          return resolved === null ? null : { moduleName: resolved.moduleName, ...resolved.declaration };
        },
        [kind]
      );
      return useEngineQuery(runtime, kindsRead(runtime), { enabled: kind !== null, select: resolve });
    },
    useKinds: () => useEngineQuery(runtime, kindsRead(runtime), { select: declaredKinds }),
    useCreateRequest: () => useEngineRequest(create),
    useUpdateRequest: () => useEngineRequest(update),
    useRemoveRequest: () => useEngineRequest(remove),
    useSyncModuleRequest: () => useEngineRequest(syncModule),
    useRefreshValuesRequest: () => useEngineRequest(refreshValues),
    useRunActionsRequest: () => useEngineRequest(runActions),
  };
}
