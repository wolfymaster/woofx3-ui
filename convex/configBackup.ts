import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalQuery, query } from "./_generated/server";
import {
  CONFIG_BUNDLE_MAX_BYTES,
  type ConfigBackupAccess,
  type ConfigBundleEngineApi,
  type ConfigImportPlan,
  type ConfigImportResult,
  chunkText,
  configBackupAccess,
  utf8ByteLength,
} from "./lib/configBundle";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { getInstanceMembership } from "./lib/teamAccess";

// Actions here run in Convex's default runtime on purpose: it accepts arguments
// up to 16 MiB, where a "use node" action stops at 5 MiB in total, which a
// bundle at the engine's own limit would exceed. Bundle text crosses the
// boundary in both directions as chunks (see chunkText), since Convex holds a
// single string to 1 MB.

const sectionsValidator = v.array(
  v.union(v.literal("workflows"), v.literal("commands"), v.literal("groups"), v.literal("resources"))
);
const conflictPolicyValidator = v.union(v.literal("skip"), v.literal("rename"), v.literal("overwrite"));

type Sections = Infer<typeof sectionsValidator>;

interface EngineContext {
  access: ConfigBackupAccess;
  url: string;
  clientId: string | null;
  clientSecret: string | null;
}

export const engineContextForUser = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }): Promise<EngineContext | null> => {
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    return {
      access: configBackupAccess(membership.role),
      url: instance.url,
      clientId: instance.clientId ?? null,
      clientSecret: instance.clientSecret ?? null,
    };
  },
});

/** What the signed-in user may do on the Backup page for this instance. */
export const access = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ConfigBackupAccess> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return configBackupAccess(null);
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    return configBackupAccess(membership?.role ?? null);
  },
});

type Permission = keyof ConfigBackupAccess;

const NOT_A_MEMBER_MESSAGE = "You are not a member of this instance.";

const DENIED_MESSAGE: Record<Permission, string> = {
  canExport: "Only owners and admins can export a backup.",
  canExportMembers: "Only owners and admins can export group members.",
  canImport: "Only owners and admins can import a backup.",
};

async function connect(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  permissions: Permission[]
): Promise<ConfigBundleEngineApi> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Sign in to back up or restore configuration.");
  }
  const context = await ctx.runQuery(internal.configBackup.engineContextForUser, { instanceId, userId });
  if (!context) {
    throw new ConvexError(NOT_A_MEMBER_MESSAGE);
  }
  for (const permission of permissions) {
    if (!context.access[permission]) {
      throw new ConvexError(DENIED_MESSAGE[permission]);
    }
  }
  if (!context.clientId || !context.clientSecret) {
    throw new ConvexError("This instance is not registered with its engine yet.");
  }
  return createEngineRpcSession<EngineApi & ConfigBundleEngineApi>(context.url, context.clientId, context.clientSecret);
}

/**
 * The engine refuses a malformed bundle with a message listing every problem
 * and its path, which is exactly what the creator needs to see.
 */
async function callEngine<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ConvexError(`${what} failed: ${message}`);
  }
}

function joinBundle(bundleChunks: string[]): string {
  const bundleText = bundleChunks.join("");
  assertBundleSize(bundleText);
  return bundleText;
}

function assertBundleSize(bundleText: string): void {
  if (bundleText.trim().length === 0) {
    throw new ConvexError("The backup file is empty.");
  }
  if (utf8ByteLength(bundleText) > CONFIG_BUNDLE_MAX_BYTES) {
    throw new ConvexError("The backup file is larger than 5 MiB.");
  }
}

function assertSections(include: Sections): void {
  if (include.length === 0) {
    throw new ConvexError("Choose at least one section.");
  }
}

/**
 * The instance's configuration as bundle JSON text, in chunks to join. Text
 * rather than an object because Convex values cannot carry the `$`-prefixed
 * keys a workflow definition may contain, and the file is written out verbatim.
 */
export const exportConfig = action({
  args: {
    instanceId: v.id("instances"),
    include: sectionsValidator,
    includeMembers: v.boolean(),
  },
  handler: async (ctx, { instanceId, include, includeMembers }): Promise<string[]> => {
    assertSections(include);
    const engine = await connect(ctx, instanceId, includeMembers ? ["canExport", "canExportMembers"] : ["canExport"]);
    const bundle = await callEngine("Export", () => engine.exportConfig({ include, includeMembers }));
    return chunkText(`${JSON.stringify(bundle, null, 2)}\n`);
  },
});

export const previewImport = action({
  args: {
    instanceId: v.id("instances"),
    bundleChunks: v.array(v.string()),
    onConflict: conflictPolicyValidator,
    include: sectionsValidator,
    applyMembers: v.boolean(),
  },
  handler: async (ctx, { instanceId, bundleChunks, onConflict, include, applyMembers }): Promise<ConfigImportPlan> => {
    const bundleText = joinBundle(bundleChunks);
    assertSections(include);
    const engine = await connect(ctx, instanceId, ["canImport"]);
    return await callEngine("Preview", () => engine.previewImport(bundleText, { onConflict, include, applyMembers }));
  },
});

/** Re-plans on the engine, so an earlier preview is advisory only. */
export const importConfig = action({
  args: {
    instanceId: v.id("instances"),
    bundleChunks: v.array(v.string()),
    onConflict: conflictPolicyValidator,
    include: sectionsValidator,
    applyMembers: v.boolean(),
  },
  handler: async (
    ctx,
    { instanceId, bundleChunks, onConflict, include, applyMembers }
  ): Promise<ConfigImportResult> => {
    const bundleText = joinBundle(bundleChunks);
    assertSections(include);
    const engine = await connect(ctx, instanceId, ["canImport"]);
    return await callEngine("Import", () => engine.importConfig(bundleText, { onConflict, include, applyMembers }));
  },
});
