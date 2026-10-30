import type {
  EngineGateway,
  GoLiveGateway,
  MacrosGateway,
  ModuleOAuthGateway,
  SetupImportsGateway,
  ShoutoutsGateway,
  StarterPacksGateway,
} from "@/engine/gateway";
import { directAdBreaksGateway } from "./ad-breaks";
import { directAlertLibraryGateway } from "./alert-library";
import { directAlertQueueGateway } from "./alert-queue";
import { directClipsGateway } from "./clips";
import { directCommandsGateway } from "./commands";
import { directConfigGateway } from "./engine-config";
import { directEventLogGateway } from "./event-log";
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

const macros: MacrosGateway = {
  useRunRequest: unsupportedRequest("macros.useRunRequest"),
};

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

const starterPacks: StarterPacksGateway = {
  useStatus: unsupportedRead("starterPacks.useStatus"),
  useInstallRequest: unsupportedRequest("starterPacks.useInstallRequest"),
};

const shoutouts: ShoutoutsGateway = {
  useQueue: unsupportedRead("shoutouts.useQueue"),
  useLookupRequest: unsupportedRequest("shoutouts.useLookupRequest"),
  useEnqueueRequest: unsupportedRequest("shoutouts.useEnqueueRequest"),
  useRemoveRequest: unsupportedRequest("shoutouts.useRemoveRequest"),
  useReorderRequest: unsupportedRequest("shoutouts.useReorderRequest"),
};

const goLive: GoLiveGateway = {
  useChecklist: unsupportedRead("goLive.useChecklist"),
  useOverlays: unsupportedRead("goLive.useOverlays"),
  useSetCheckDismissedRequest: unsupportedRequest("goLive.useSetCheckDismissedRequest"),
  useCheckTwitchRequest: unsupportedRequest("goLive.useCheckTwitchRequest"),
  useCheckStreamInfoRequest: unsupportedRequest("goLive.useCheckStreamInfoRequest"),
  useCompleteRequest: unsupportedRequest("goLive.useCompleteRequest"),
};

/**
 * The gateway that talks to one engine directly, with no Convex in between.
 * Built once at boot around `runtime`, which must be started for its reads to
 * load; the namespaces share its connection and its one query cache.
 */
export function createDirectEngineGateway(runtime: DirectRuntime): EngineGateway {
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
    macros,
    streamOps: directStreamOpsGateway(runtime),
    config: directConfigGateway(runtime),
    session: directSessionGateway(runtime),
    twitchLink: directTwitchLinkGateway(runtime),
    overlays: directOverlaysGateway(runtime),
    moduleOAuth,
    setupImports,
    starterPacks,
    adBreaks: directAdBreaksGateway(runtime),
    moderation: directModerationGateway(runtime),
    pins: directPinsGateway(runtime),
    shoutouts,
    twitchChat: directTwitchChatGateway(runtime),
    clips: directClipsGateway(runtime),
    streamInfo: directStreamInfoGateway(runtime),
    goLive,
    pageIntros: directPageIntrosGateway(runtime),
  };
}
