import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { engineRefusalReason, isEngineTransportFailure, type MacroRunPlan } from "./macroTrigger";

export interface MacroEngineContext {
  url: string;
  clientId: string;
  clientSecret: string;
  /**
   * The channel's Twitch login, which a chat-command macro runs as. The
   * broadcaster holds every command grant, so a macro can run whatever the
   * streamer could type. Null when no Twitch account is linked.
   */
  broadcasterLogin: string | null;
}

/** Why a planned run could not reach the engine, surfaced to the caller as-is. */
export class MacroRunRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacroRunRefused";
  }
}

/**
 * Ask the engine to perform a planned macro run. `triggeredBy` is the run's
 * provenance: "dashboard" runs are live-watched and not recorded in the run
 * history, anything else is.
 */
export async function executeMacroPlan(
  engine: MacroEngineContext,
  plan: MacroRunPlan,
  triggeredBy: string
): Promise<{ triggerId?: string }> {
  const rpc = createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);

  if (plan.kind === "trigger-workflow") {
    // Minted before the call, so a caller can subscribe to the outcome before
    // the run exists.
    const triggerId = crypto.randomUUID();
    await rpc.triggerWorkflowByName(plan.workflowNameOrId, {}, undefined, triggerId, triggeredBy);
    return { triggerId };
  }

  if (!engine.broadcasterLogin) {
    throw new MacroRunRefused("link a Twitch account before running chat-command macros");
  }
  let result: { success: boolean; message: string };
  try {
    result = await rpc.executeCommand(plan.commandName, engine.broadcasterLogin, plan.text);
  } catch (err) {
    // executeCommand refuses by throwing ("Command is disabled", a permission
    // denial, an unknown command); those are answers, not outages.
    if (err instanceof Error && !isEngineTransportFailure(err)) {
      throw new MacroRunRefused(engineRefusalReason(err));
    }
    throw err;
  }
  if (!result.success) {
    throw new MacroRunRefused(result.message || `the engine refused "!${plan.commandName}"`);
  }
  return {};
}

/**
 * Everything needed to run a macro against the instance's engine, or null when
 * the instance is gone or has not finished registering.
 */
export async function loadMacroEngineContext(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<MacroEngineContext | null> {
  const instance = await ctx.db.get(instanceId);
  if (!instance?.url || !instance.clientId || !instance.clientSecret) {
    return null;
  }
  // An instance links at most one account per platform; the bound only keeps
  // the read finite.
  const links = await ctx.db
    .query("platformLinks")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(20);
  const twitch = links.find((link) => link.platform === "twitch");
  return {
    url: instance.url,
    clientId: instance.clientId,
    clientSecret: instance.clientSecret,
    broadcasterLogin: twitch?.platformUsername ?? null,
  };
}

/** Variable values as they cross a Convex boundary: pairs, because a record key may not start with `_`. */
export function valuesFromPairs(pairs: ReadonlyArray<{ name: string; value: string }>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { name, value } of pairs) {
    values[name] = value;
  }
  return values;
}

export function valuesToPairs(values: Readonly<Record<string, string>>): { name: string; value: string }[] {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}
