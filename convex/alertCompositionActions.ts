import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { type InstanceContext, requireInstanceContext } from "./sceneActions";

// The engine's alert library (capability `compositions.alerts`): alerts
// stored in the engine as starting points. A step never plays one by id: the
// alert editor copies one into the step, which keeps the copy. Every
// write reaches the cache through the engine's `scene.*` webhooks, which
// carry `kind: "alert"`; `refresh` catches the cache up by listing them. The
// document itself is edited through the scene editor socket
// (`sceneActions.getSceneEditorSession` takes an alert's id).

/**
 * The instance's engine, refused unless it stores alert compositions. Asked
 * each time over its own session: a capnweb HTTP batch is spent by its first
 * call, and an engine is updated by restarting it, so no answer is kept.
 */
async function requireAlertLibrary(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceContext> {
  const engine = await requireInstanceContext(ctx, instanceId);
  const capabilities = await fetchEngineCapabilities(engine);
  if (!hasEngineCapability(capabilities, "compositions.alerts")) {
    throw new ConvexError("This engine doesn't keep an alert library. Update the engine to use one.");
  }
  return engine;
}

function session(engine: InstanceContext): EngineApi {
  return createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
}

/** Reads the engine's whole library into the cache (`alertCompositions.list`). */
export const refresh = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<{ count: number }> => {
    const engine = await requireAlertLibrary(ctx, args.instanceId);
    const { compositions } = await session(engine).listAlertCompositions();
    await ctx.runMutation(internal.alertCompositions.reconcileFromEngine, {
      instanceId: args.instanceId,
      compositions: compositions.map((composition) => ({
        engineCompositionId: composition.id,
        name: composition.name,
        description: composition.description,
        widgetsJson: composition.widgetsJson,
        layoutJson: composition.layoutJson,
        behaviorsJson: composition.behaviorsJson,
        inputsJson: composition.inputsJson,
        createdByType: composition.createdByType,
        createdByRef: composition.createdByRef,
      })),
    });
    return { count: compositions.length };
  },
});

/**
 * Stores a new alert. The JSON fields are the composition in the engine's
 * stored shapes (see `libraryJsonOf` in client/src/lib/alert-library.ts).
 */
export const create = action({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    widgetsJson: v.string(),
    layoutJson: v.string(),
    behaviorsJson: v.string(),
    inputsJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ engineCompositionId: string }> => {
    const name = args.name.trim();
    if (name === "") {
      throw new ConvexError("An alert in the library needs a name.");
    }
    const engine = await requireAlertLibrary(ctx, args.instanceId);
    const result = await session(engine).createAlertComposition({
      name,
      description: args.description,
      widgetsJson: args.widgetsJson,
      layoutJson: args.layoutJson,
      behaviorsJson: args.behaviorsJson,
      inputsJson: args.inputsJson,
      correlationKey: crypto.randomUUID(),
    });
    return { engineCompositionId: result.id };
  },
});

/** Renames an alert or replaces the inputs it declares; the document changes through the editor socket. */
export const update = action({
  args: {
    instanceId: v.id("instances"),
    engineCompositionId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    inputsJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const engine = await requireAlertLibrary(ctx, args.instanceId);
    return await session(engine).updateAlertComposition(args.engineCompositionId, {
      name: args.name,
      description: args.description,
      inputsJson: args.inputsJson,
      correlationKey: crypto.randomUUID(),
    });
  },
});

/**
 * Deletes an alert. Steps hold copies of library alerts, never references,
 * so nothing that plays depends on it.
 */
export const remove = action({
  args: { instanceId: v.id("instances"), engineCompositionId: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const engine = await requireAlertLibrary(ctx, args.instanceId);
    const result = await session(engine).deleteAlertComposition(args.engineCompositionId, crypto.randomUUID());
    return { success: result.success };
  },
});
