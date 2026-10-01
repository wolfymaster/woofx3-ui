import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { deleteEngine, isEngineNotFound } from "./maintenanceClient";

/**
 * Deletes an instance and everything outside Convex that belongs to it. The
 * caller has already decided the deleting user may do so.
 */
export async function deleteInstanceAndEngine(ctx: ActionCtx, instance: Doc<"instances">): Promise<void> {
  // Unregister from the engine best-effort — delete the client record so it
  // stops receiving callbacks. Failure here (engine unreachable, client
  // already gone) must not block the local delete since the UI's instance
  // record is the source of truth for the user's view.
  if (instance.clientId && instance.clientSecret) {
    try {
      const engine = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
      await engine.deleteClient(instance.clientId);
    } catch (err) {
      console.warn("[deleteInstanceAndEngine] engine.deleteClient failed (proceeding with local delete)", err);
    }
  }

  // A managed engine is torn down before the instance is deleted, never
  // after: the maintenance API holds its address, route, container and
  // database until asked, and once the instance and its provisioning row
  // are gone nothing in the UI could ask any more. A failure here stops the
  // delete so the user can try again.
  const provisioning = await ctx.runQuery(internal.provisioningInternal.forInstanceInternal, {
    instanceId: instance._id,
  });
  if (provisioning?.maintenanceEngineId && provisioning.status !== "deleted") {
    try {
      await deleteEngine(provisioning.maintenanceEngineId, `${provisioning._id}:delete`);
    } catch (err) {
      if (!isEngineNotFound(err)) {
        throw new Error(
          `Couldn't remove the managed engine, so the instance was kept: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  await ctx.runMutation(internal.instances.deleteInstanceData, { instanceId: instance._id });
}
