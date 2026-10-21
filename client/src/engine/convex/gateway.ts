import type { EngineGateway } from "@/engine/gateway";
import { convexAlertLibraryGateway } from "./alert-library";
import { convexAlertQueueGateway } from "./alert-queue";
import { convexCommandsGateway } from "./commands";
import { convexConfigGateway } from "./config";
import { convexEventLogGateway } from "./event-log";
import { convexMacrosGateway } from "./macros";
import { convexModuleResourcesGateway } from "./module-resources";
import { convexModulesGateway } from "./modules";
import { convexRequestsGateway } from "./requests";
import { convexResourcesGateway } from "./resources";
import { convexScenesGateway } from "./scenes";
import { convexSessionGateway } from "./session";
import { convexStatusGateway } from "./status";
import { convexStreamOpsGateway } from "./stream-ops";
import { convexTwitchLinkGateway } from "./twitch-link";
import { convexWorkflowsGateway } from "./workflows";

/**
 * The engine reached through Convex: reads and calls go to Convex functions
 * that relay to the engine or read what it has mirrored there, and realtime
 * goes over the browser transport. This directory is the only client code
 * allowed to name those Convex functions.
 */
export const convexEngineGateway: EngineGateway = {
  status: convexStatusGateway,
  resources: convexResourcesGateway,
  eventLog: convexEventLogGateway,
  alertQueue: convexAlertQueueGateway,
  alertLibrary: convexAlertLibraryGateway,
  commands: convexCommandsGateway,
  moduleResources: convexModuleResourcesGateway,
  modules: convexModulesGateway,
  scenes: convexScenesGateway,
  workflows: convexWorkflowsGateway,
  requests: convexRequestsGateway,
  macros: convexMacrosGateway,
  streamOps: convexStreamOpsGateway,
  config: convexConfigGateway,
  session: convexSessionGateway,
  twitchLink: convexTwitchLinkGateway,
};
