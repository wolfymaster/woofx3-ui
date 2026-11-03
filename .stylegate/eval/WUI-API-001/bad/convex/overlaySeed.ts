import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

interface EngineBundle {
  url: string;
  clientId: string;
  clientSecret: string;
}

export async function seedOverlay(ctx: ActionCtx, instanceId: Id<"instances">, bundle: EngineBundle) {
  const engine = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
  const widgets = await engine.getAvailableWidgets();
  const scene = await engine.createScene({ name: "Overlay", widgets: widgets.slice(0, 3) });
  return { instanceId, sceneId: scene.id };
}

export async function readModuleKey(bundle: EngineBundle): Promise<string> {
  const api = await createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
  const modules = api.listEngineModules();
  return (await modules)[0]?.moduleKey ?? "";
}
