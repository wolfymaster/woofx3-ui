import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { EngineApi } from "../engineInstanceUrl";
import { commandsStep } from "./steps/commands";
import { modulesStep } from "./steps/modules";
import { scenesStep } from "./steps/scenes";
import { workflowsStep } from "./steps/workflows";

export type SyncStepName = "commands" | "modules" | "workflows" | "scenes";

export interface SyncStepContext {
  ctx: ActionCtx;
  /**
   * Factory that opens a fresh capnweb HTTP batch RPC session. capnweb
   * sessions are single-use — the entire batch is sent on the first
   * `await`, so each engine round-trip (including each page of a
   * paginated read) MUST call `newApi()` to obtain a new stub.
   */
  newApi: () => EngineApi;
  instanceId: Id<"instances">;
  applicationId: string;
}

export interface SyncStep {
  name: SyncStepName;
  run(c: SyncStepContext): Promise<{ itemsProcessed: number }>;
}

// Populated by Tasks 5-8. Order here is the order steps run.
export const SYNC_STEPS: readonly SyncStep[] = [commandsStep, modulesStep, workflowsStep, scenesStep];
