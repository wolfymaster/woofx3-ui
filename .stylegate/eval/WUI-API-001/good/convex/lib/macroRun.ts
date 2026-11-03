import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";

interface MacroEngine {
  url: string;
  clientId: string;
  clientSecret: string;
}

export async function runMacro(engine: MacroEngine, plan: { kind: "workflow" | "actions"; name: string }, by: string) {
  const rpc = createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
  if (plan.kind === "workflow") {
    await rpc.triggerWorkflowByName(plan.name, {}, undefined, crypto.randomUUID(), by);
    return;
  }
  await rpc.runActions({ name: plan.name, triggeredBy: by });
}

export async function readBoth(engine: MacroEngine) {
  const rpc = createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
  const [info, modules] = await Promise.all([rpc.getEngineInfo(), rpc.listEngineModules()]);
  return { info, modules };
}
