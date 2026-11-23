import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalQuery } from "../_generated/server";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { requireInstanceRoleInAction } from "./instanceAccess";
import type { InstanceRole } from "./instanceRoles";

// The one way a user-facing action reaches an instance's engine. The engine
// client id and secret are a service token: they are read here, inside Convex,
// and never returned to a browser. The role check comes first, so the engine
// is only ever spoken to on behalf of someone allowed to ask.

/** The engine address and service credentials of an instance; null when it is not registered. */
export const engineCredentials = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const instance = await ctx.db.get(instanceId);
    if (!instance?.clientId || !instance.clientSecret) {
      return null;
    }
    return { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
  },
});

export interface InstanceEngine {
  /** The URL the instance was registered with. */
  url: string;
  /** A fresh single-use batch session: chain the call you want onto it, never reuse it. */
  session(): EngineApi;
}

export async function instanceEngine(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  role: InstanceRole
): Promise<InstanceEngine> {
  await requireInstanceRoleInAction(ctx, instanceId, role);
  const credentials = await ctx.runQuery(internal.lib.instanceEngine.engineCredentials, { instanceId });
  if (credentials === null) {
    throw new Error("Instance is not registered with the engine");
  }
  const { url, clientId, clientSecret } = credentials;
  return { url, session: () => createEngineRpcSession<EngineApi>(url, clientId, clientSecret) };
}
