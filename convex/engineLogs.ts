import { v } from "convex/values";
import { action } from "./_generated/server";
import { engineApiUrl } from "./lib/engineInstanceUrl";
import { instanceEngine } from "./lib/instanceEngine";
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

export const listFiles = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().listLogFiles();
  },
});

export const search = action({
  args: { instanceId: v.id("instances"), query: queryValidator },
  handler: async (ctx, { instanceId, query: logQuery }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().queryLogs(logQuery);
  },
});

export const access = action({
  args: { instanceId: v.id("instances"), scope: scopeValidator },
  handler: async (ctx, { instanceId, scope }) => {
    const engine = await instanceEngine(ctx, instanceId, ROLE_FOR_SCOPE[scope]);
    const grant = await engine.session().createLogAccess(scope);
    return { origin: new URL(engineApiUrl(engine.url)).origin, ...grant };
  },
});
