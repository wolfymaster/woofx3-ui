import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { EngineApi } from "../engineInstanceUrl";
import { actionsStep } from "./steps/actions";
import { commandsStep } from "./steps/commands";
import { scenesStep } from "./steps/scenes";
import { triggersStep } from "./steps/triggers";
import { widgetsStep } from "./steps/widgets";
import { workflowsStep } from "./steps/workflows";

export type SyncStepName = "commands" | "workflows" | "scenes" | "triggers" | "actions" | "widgets";

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

export const SYNC_STEPS: readonly SyncStep[] = [commandsStep, workflowsStep, scenesStep, triggersStep, actionsStep, widgetsStep];
