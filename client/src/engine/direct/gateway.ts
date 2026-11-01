import type { DesktopHostState } from "@/engine/desktop-host";
import type { EngineGateway, ModuleOAuthGateway, SetupImportsGateway } from "@/engine/gateway";
import { directAdBreaksGateway } from "./ad-breaks";
import { directAlertLibraryGateway } from "./alert-library";
import { directAlertQueueGateway } from "./alert-queue";
import { directClipsGateway } from "./clips";
import { directCommandsGateway } from "./commands";
import { directDashboardGateway } from "./dashboard";
import { directConfigGateway } from "./engine-config";
import { directEventLogGateway } from "./event-log";
import { directFormSubmissionsGateway } from "./form-submissions";
import { directGoLiveGateway } from "./go-live";
import { directMacrosGateway } from "./macros";
import { directMarketplaceGateway } from "./marketplace";
import { directModerationGateway } from "./moderation";
import { directModuleResourcesGateway } from "./module-resources";
import { directModulesGateway } from "./modules";
import { directOverlaysGateway } from "./overlays";
import { directPageIntrosGateway } from "./page-intros";
import { directPinsGateway } from "./pins";
import { directRequestsGateway } from "./requests";
import { directResourcesGateway } from "./resources";
import type { DirectRuntime } from "./runtime";
import { directScenesGateway } from "./scenes";
import { directSessionGateway } from "./session";
import { directShoutoutsGateway } from "./shoutouts";
import { directStarterPacksGateway } from "./starter-packs";
import { directStatusGateway } from "./status";
import { directStreamInfoGateway } from "./stream-info";
import { directStreamOpsGateway } from "./stream-ops";
import { directTwitchChatGateway } from "./twitch-chat";
import { directTwitchLinkGateway } from "./twitch-link";
import { unsupportedRead, unsupportedRequest } from "./unsupported";
import { directWorkflowsGateway } from "./workflows";

// Namespaces whose data the Convex gateway keeps in its own tables, and that
// have no home on a lone engine yet. Every member is named, so a screen that
// reaches one fails with the member it used rather than an empty answer.

const moduleOAuth: ModuleOAuthGateway = {
  useConnectRequest: unsupportedRequest("moduleOAuth.useConnectRequest"),
  useFinishRequest: unsupportedRequest("moduleOAuth.useFinishRequest"),
};

const setupImports: SetupImportsGateway = {
  useLatest: unsupportedRead("setupImports.useLatest"),
  useAnalyzeRequest: unsupportedRequest("setupImports.useAnalyzeRequest"),
  useStartRequest: unsupportedRequest("setupImports.useStartRequest"),
  useRetryRequest: unsupportedRequest("setupImports.useRetryRequest"),
  useDiscardRequest: unsupportedRequest("setupImports.useDiscardRequest"),
};

/**
 * The gateway that talks to one engine directly, with no Convex in between.
 * Built once at boot around `runtime`, which must be started for its reads to
 * load; the namespaces share its connection and its one query cache.
 * `host` holds the UI state the desktop host keeps outside the engine.
 */
export function createDirectEngineGateway(runtime: DirectRuntime, host: DesktopHostState): EngineGateway {
  return {
    status: directStatusGateway(runtime),
    resources: directResourcesGateway(runtime),
    eventLog: directEventLogGateway(runtime),
    alertQueue: directAlertQueueGateway(runtime),
    alertLibrary: directAlertLibraryGateway(runtime),
    commands: directCommandsGateway(runtime),
    moduleResources: directModuleResourcesGateway(runtime),
    modules: directModulesGateway(runtime),
    marketplace: directMarketplaceGateway(runtime),
    scenes: directScenesGateway(runtime),
    workflows: directWorkflowsGateway(runtime),
    requests: directRequestsGateway(runtime),
    macros: directMacrosGateway(runtime),
    streamOps: directStreamOpsGateway(runtime),
    config: directConfigGateway(runtime),
    session: directSessionGateway(runtime),
    twitchLink: directTwitchLinkGateway(runtime),
    overlays: directOverlaysGateway(runtime),
    moduleOAuth,
    setupImports,
    starterPacks: directStarterPacksGateway(runtime),
    adBreaks: directAdBreaksGateway(runtime),
    moderation: directModerationGateway(runtime),
    pins: directPinsGateway(runtime),
    shoutouts: directShoutoutsGateway(runtime, host.shoutoutQueue),
    twitchChat: directTwitchChatGateway(runtime),
    clips: directClipsGateway(runtime),
    formSubmissions: directFormSubmissionsGateway,
    streamInfo: directStreamInfoGateway(runtime),
    goLive: directGoLiveGateway(runtime, host.streamStartMarkers),
    pageIntros: directPageIntrosGateway(runtime),
    dashboard: directDashboardGateway(runtime),
  };
}
