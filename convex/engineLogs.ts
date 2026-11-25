import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi, engineApiUrl } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import type { InstanceRole } from "./lib/instanceRoles";

// Reads of the engine's own log files. The engine does not decide who may read
// them: these actions check the viewer's role, then speak to the engine as the
// instance. The live tail and the zip are plain HTTP on the engine, so `access`
// has the engine sign a short-lived address and the browser fetches it direct.

const levelValidator = v.union(
  v.literal("trace"),
  v.literal("debug"),
  v.literal("info"),
  v.literal("warn"),
  v.literal("error"),
  v.literal("fatal"),
  v.literal("unknown")
);

const queryValidator = v.object({
  levels: v.optional(v.array(levelValidator)),
  services: v.optional(v.array(v.string())),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  text: v.optional(v.string()),
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
});

const scopeValidator = v.union(v.literal("stream"), v.literal("export"));

/** What each scope needs: reading is for members, taking every log away is for admins. */
const ROLE_FOR_SCOPE = { stream: "member", export: "admin" } as const satisfies Record<string, InstanceRole>;

interface InstanceEngine {
  url: string;
  session(): EngineApi;
}

async function engineFor(ctx: ActionCtx, instanceId: Id<"instances">, role: InstanceRole): Promise<InstanceEngine> {
  await requireInstanceRoleInAction(ctx, instanceId, role);
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForInstance, { instanceId });
  const { url, clientId, clientSecret } = bundle ?? {};
  if (!url || !clientId || !clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return { url, session: () => createEngineRpcSession<EngineApi>(url, clientId, clientSecret) };
}

export const listFiles = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const engine = await engineFor(ctx, instanceId, "member");
    return engine.session().listLogFiles();
  },
});

export const search = action({
  args: { instanceId: v.id("instances"), query: queryValidator },
  handler: async (ctx, { instanceId, query: logQuery }) => {
    const engine = await engineFor(ctx, instanceId, "member");
    return engine.session().queryLogs(logQuery);
  },
});

export const access = action({
  args: { instanceId: v.id("instances"), scope: scopeValidator },
  handler: async (ctx, { instanceId, scope }) => {
    const engine = await engineFor(ctx, instanceId, ROLE_FOR_SCOPE[scope]);
    const grant = await engine.session().createLogAccess(scope);
    return { origin: new URL(engineApiUrl(engine.url)).origin, ...grant };
  },
});
