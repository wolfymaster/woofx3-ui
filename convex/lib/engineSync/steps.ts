import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { EngineApi } from "../engineInstanceUrl";
import { actionsStep } from "./steps/actions";
import { commandsStep } from "./steps/commands";
import { databasesStep } from "./steps/databases";
import { engineCapabilitiesStep } from "./steps/engineCapabilities";
import { eventQueueStep } from "./steps/eventQueue";
import { functionsStep } from "./steps/functions";
import { groupsStep } from "./steps/groups";
import { modulesStep } from "./steps/modules";
import { resourcesStep } from "./steps/resources";
import { scenesStep } from "./steps/scenes";
import { triggersStep } from "./steps/triggers";
import { widgetsStep } from "./steps/widgets";
import { workflowGroupsStep } from "./steps/workflowGroups";
import { workflowsStep } from "./steps/workflows";

export type SyncStepName =
  | "engineCapabilities"
  | "modules"
  | "commands"
  | "groups"
  | "functions"
  | "workflows"
  | "workflowGroups"
  | "scenes"
  | "triggers"
  | "actions"
  | "widgets"
  | "resources"
  | "databases"
  | "eventQueue";

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
}

export interface SyncStep {
  name: SyncStepName;
  run(c: SyncStepContext): Promise<{ itemsProcessed: number }>;
}

export const SYNC_STEPS: readonly SyncStep[] = [
  // Before everything: later steps gate on what the engine advertises.
  engineCapabilitiesStep,
  // First: every later step resolves an engine record back to its
  // moduleRepository row, and `resources` drops an instance whose module has
  // none. A module installed since the last sweep has no row until this runs.
  modulesStep,
  commandsStep,
  groupsStep,
  functionsStep,
  workflowsStep,
  workflowGroupsStep,
  scenesStep,
  triggersStep,
  actionsStep,
  widgetsStep,
  resourcesStep,
  // After resources: which databases have a public column is read from their mirrored settings.
  databasesStep,
  // Moves an engine onto the event queue once it advertises support, so an
  // engine upgraded in place moves at its next sync.
  eventQueueStep,
];
