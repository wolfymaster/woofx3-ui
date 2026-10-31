import type { EngineGateway } from "@/engine/gateway";
import { convexAdBreaksGateway } from "./ad-breaks";
import { convexAlertLibraryGateway } from "./alert-library";
import { convexAlertQueueGateway } from "./alert-queue";
import { convexClipsGateway } from "./clips";
import { convexCommandsGateway } from "./commands";
import { convexConfigGateway } from "./config";
import { convexDashboardGateway } from "./dashboard";
import { convexEventLogGateway } from "./event-log";
import { convexGoLiveGateway } from "./go-live";
import { convexMacrosGateway } from "./macros";
import { convexModerationGateway } from "./moderation";
import { convexModuleOAuthGateway } from "./module-oauth";
import { convexModuleResourcesGateway } from "./module-resources";
import { convexModulesGateway } from "./modules";
import { convexOverlaysGateway } from "./overlays";
import { convexPageIntrosGateway } from "./page-intros";
import { convexPinsGateway } from "./pins";
import { convexRequestsGateway } from "./requests";
import { convexResourcesGateway } from "./resources";
import { convexScenesGateway } from "./scenes";
import { convexSessionGateway } from "./session";
import { convexSetupImportsGateway } from "./setup-imports";
import { convexShoutoutsGateway } from "./shoutouts";
import { convexStarterPacksGateway } from "./starter-packs";
import { convexStatusGateway } from "./status";
import { convexStreamInfoGateway } from "./stream-info";
import { convexStreamOpsGateway } from "./stream-ops";
import { convexTwitchChatGateway } from "./twitch-chat";
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
  overlays: convexOverlaysGateway,
  moduleOAuth: convexModuleOAuthGateway,
  setupImports: convexSetupImportsGateway,
  starterPacks: convexStarterPacksGateway,
  adBreaks: convexAdBreaksGateway,
  moderation: convexModerationGateway,
  pins: convexPinsGateway,
  shoutouts: convexShoutoutsGateway,
  twitchChat: convexTwitchChatGateway,
  clips: convexClipsGateway,
  streamInfo: convexStreamInfoGateway,
  goLive: convexGoLiveGateway,
  pageIntros: convexPageIntrosGateway,
  dashboard: convexDashboardGateway,
};
