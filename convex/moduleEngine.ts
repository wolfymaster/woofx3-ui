"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi, engineApiUrl } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";

/**
 * Map an engine RPC error to a user-friendly message. The capnweb layer throws
 * bare TypeErrors when the engine is unreachable (`fetch failed`) — we translate
 * those into a clear "engine URL is wrong or engine is offline" message so the
 * UI can show something actionable instead of a cryptic JS error.
 */
function toFriendlyEngineError(err: unknown, instanceUrl: string): Error {
  if (err instanceof TypeError && err.message === "fetch failed") {
    return new Error(
      `Could not reach the engine at ${engineApiUrl(instanceUrl)}. ` +
        "Check that the engine is running and the URL in Settings is correct."
    );
  }
  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
}

/**
 * The engine throws this synchronously (before any webhook fires) when
 * uninstallModule can't resolve the moduleKey to an installed module. That
 * means the engine already has no record of it — our moduleRepository row is
 * stale, most likely from a prior uninstall that succeeded on the engine but
 * whose webhook never landed (or a manual removal on the engine side). Treat
 * it as "already gone" and reconcile rather than surfacing a failure the user
 * can't act on.
 */
function isModuleNotFoundOnEngine(err: unknown): boolean {
  return err instanceof Error && /no module found for moduleKey/i.test(err.message);
}

/**
 * Local extension of the shared EngineApi for methods the engine exposes
 * but which haven't made it into @woofx3/api yet. Remove each entry as the
 * shared interface catches up.
 */
export interface LocalEngineApi extends EngineApi {
  setEngineModuleState(name: string, state: string): Promise<unknown>;
}

interface EngineModule {
  name: string;
  version: string;
  state: string;
}

export const listEngineModules = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<EngineModule[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);

    try {
      const result = await rpc.listEngineModules();

      return (result ?? [])
        .filter((m) => !!m.name)
        .map((m) => ({
          name: m.name ?? "",
          version: m.version ?? "",
          state: m.state ?? "active",
        }));
    } catch (e) {
      console.error("listEngineModules RPC failed:", e);
      throw toFriendlyEngineError(e, bundle.url);
    }
  },
});

/**
 * Install a module from an archive the streamer uploaded to their own storage
 * (a `custom_module` resource). The engine reads the archive itself, refuses
 * any permission or local endpoint its manifest declares outside the
 * approved lists, and resolves at once with the key the install's outcome is
 * reported under, as a `module.install` transient event.
 */
export const installFromResource = action({
  args: {
    instanceId: v.id("instances"),
    resourceId: v.string(),
    approvedPermissions: v.array(v.string()),
    approvedLocalEndpoints: v.array(v.string()),
  },
  handler: async (
    ctx,
    { instanceId, resourceId, approvedPermissions, approvedLocalEndpoints }
  ): Promise<{ moduleKey: string }> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new ConvexError("This instance is not connected to its engine yet.");
    }
    const engine = { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
    if (!hasEngineCapability(await fetchEngineCapabilities(engine), "modules.resourceInstall")) {
      throw new ConvexError("This engine can't install uploaded modules. Update the engine to upload one.");
    }
    return await createEngineRpcSession<EngineApi>(
      engine.url,
      engine.clientId,
      engine.clientSecret
    ).installModuleFromResource(resourceId, { approvedPermissions, approvedLocalEndpoints });
  },
});

/**
 * Request an async uninstall of a module from the engine.
 *
 * Fires-and-forgets an RPC to the engine; the engine performs the uninstall in the
 * background and POSTs a module.uninstalled or module.uninstall_failed webhook back.
 * The UI subscribes to the transient event keyed by the returned moduleKey to observe
 * progress, success, or a conflict-list failure.
 */
export const requestModuleUninstall = action({
  args: { instanceId: v.id("instances"), moduleId: v.id("moduleRepository") },
  handler: async (ctx, { instanceId, moduleId }): Promise<{ moduleKey: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }
    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const module = await ctx.runQuery(api.moduleRepository.get, { moduleId });
    if (!module || module.instanceId !== instanceId) {
      throw new Error("Module not found");
    }

    const moduleKey = module.moduleKey ?? `${module.name}:${module.version}:manual-${Date.now()}`;

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey: moduleKey,
      type: "module.uninstall",
      status: "progress",
      message: `Requesting uninstall of ${module.name}@${module.version}...`,
      data: { moduleName: module.name, moduleVersion: module.version },
    });

    try {
      const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      await rpc.uninstallModule(moduleKey);
      return { moduleKey };
    } catch (err) {
      if (isModuleNotFoundOnEngine(err)) {
        // The engine has no record of this module, so there's nothing left to
        // uninstall — reconcile by cascade-deleting our stale record and
        // reporting success, same as a normal module.deleted webhook would.
        await ctx.runMutation(internal.moduleWebhook.processModuleDeleted, {
          instanceId,
          correlationKey: moduleKey,
          moduleName: module.name,
          moduleVersion: module.version,
        });
        return { moduleKey };
      }

      const friendly = toFriendlyEngineError(err, bundle.url);
      await ctx.runMutation(internal.transientEvents.emit, {
        instanceId,
        correlationKey: moduleKey,
        type: "module.uninstall",
        status: "error",
        message: friendly.message,
        data: { moduleName: module.name, moduleVersion: module.version },
      });
      throw friendly;
    }
  },
});

/**
 * Reconcile an uninstall the UI gave up waiting on (client-side timeout with
 * no module.deleted/module.delete_failed webhook received). Asks the engine
 * directly whether the module is still installed rather than trusting a
 * webhook that may have been dropped in transit, arrived after a transient
 * Convex-side failure, or simply outlasted the engine's single delivery
 * retry — all of which otherwise leave the record stuck in Convex even
 * though the engine finished the removal.
 */
export const reconcileUninstall = action({
  args: { instanceId: v.id("instances"), moduleId: v.id("moduleRepository"), correlationKey: v.string() },
  handler: async (ctx, { instanceId, moduleId, correlationKey }): Promise<{ stillInstalled: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }
    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const module = await ctx.runQuery(api.moduleRepository.get, { moduleId });
    if (!module || module.instanceId !== instanceId) {
      // Already reconciled (or removed) by the time we got here.
      return { stillInstalled: false };
    }

    const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const engineModules = await rpc.listEngineModules();
    const stillInstalled = (engineModules ?? []).some((m) => m.name === module.name);

    if (!stillInstalled) {
      await ctx.runMutation(internal.moduleWebhook.reconcileUninstalledModule, {
        instanceId,
        moduleId,
        correlationKey,
      });
    }

    return { stillInstalled };
  },
});

export const setEngineModuleState = action({
  args: { instanceId: v.id("instances"), name: v.string(), state: v.string() },
  handler: async (ctx, { instanceId, name, state }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);

    await rpc.setEngineModuleState(name, state);
    return { success: true };
  },
});

/**
 * List engine workflows as `{ id, name }` pairs for UI pickers (e.g. the
 * macro pad's "Trigger Workflow" dropdown). Flattens the engine's
 * PaginatedWorkflows response to the minimum the picker needs.
 */
export const listWorkflows = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Array<{ id: string; name: string }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }
    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.getWorkflows();
    return (result?.workflows ?? []).map((w) => ({ id: w.id, name: w.name }));
  },
});
