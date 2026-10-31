/**
 * The domains the UI reaches the engine through, one `EngineGateway` namespace
 * each, and the Convex modules that serve each domain today.
 *
 * A module listed here relays to the engine, mirrors engine state, or keeps
 * data a namespace serves from either store (the macro pad), so only the
 * Convex adapter (client/src/engine/convex/) may call it; boundary.test.ts
 * holds every other file to that. An entry naming a function
 * (`marketplace.installModule`) claims that function alone, leaving the rest
 * of the module cloud-owned.
 *
 * Cloud-owned modules (accounts, instances, provisioning, the legacy module listings, Twitch
 * calls the engine has no method for, dashboard preferences) are not engine access and stay out.
 */
export const ENGINE_NAMESPACE_MODULES = {
  status: [
    "engineCapabilities",
    "engineInfo",
    "engineHealth",
    "obsStatus",
    "instanceLiveState",
    "streamStatus",
    "engineSync",
  ],
  resources: ["resources"],
  eventLog: ["engineEventLog"],
  alertQueue: ["engineAlerts", "alertActions", "alertLog"],
  alertLibrary: ["alertCompositions", "alertCompositionActions", "compositionPreview"],
  commands: ["chatCommands", "chatCommandGroups", "chatCommandActions"],
  moduleResources: ["moduleResourceActions", "moduleResourceInstances", "resourceValues", "resourceKinds"],
  modules: [
    "moduleEngine",
    "moduleSettingsActions",
    "moduleFiles",
    "moduleDetail",
    "moduleStorage",
    // The rest of marketplace is the legacy module listings, which the cloud serves.
    "marketplace.installModule",
    "marketplaceCatalog.installBundle",
    // The rest of moduleRepository is the cloud's own record of installed modules.
    "moduleRepository.list",
    "moduleRepository.generateUploadUrl",
    "moduleRepository.uploadAndDeliver",
  ],
  marketplace: [
    // installBundle is modules'.
    "marketplaceCatalog.search",
    "marketplaceCatalog.getListing",
    "marketplaceCatalog.getAuthor",
    "marketplaceCatalog.counts",
    "marketplaceCatalog.quote",
    "marketplaceCatalog.entitlements",
    "marketplaceCatalog.createCheckout",
  ],
  scenes: ["scenes", "sceneActions", "sceneWidgets"],
  requests: ["transientEvents", "fieldOptions"],
  workflows: ["workflows", "workflowActions", "workflowRuns", "workflowHealth", "workflowCatalog", "viewerFacts"],
  macros: ["macros"],
  streamOps: ["streamRecap", "streamSessionSummaries", "supporters", "debug"],
  config: [
    // configBackup.access is the caller's role, read from Convex.
    "configBackup.exportConfig",
    "configBackup.previewImport",
    "configBackup.importConfig",
    "storage",
  ],
  overlays: ["browserSource"],
  moduleOAuth: ["moduleOAuth"],
  setupImports: ["setupImports"],
  starterPacks: ["starterPacks"],
  twitchLink: [
    "instances.getPlatformLinks",
    // finishConnect completes Convex's own OAuth redirect on the callback page,
    // which a gateway that links another way never reaches.
    "twitchIntegration.startConnect",
    "twitchIntegration.disconnect",
  ],
  adBreaks: ["adBreaks"],
  moderation: ["moderation"],
  pins: ["pins"],
  shoutouts: [
    // listChatters is twitchChat's.
    "shoutouts.listQueue",
    "shoutouts.lookupUser",
    "shoutouts.enqueue",
    "shoutouts.removeEntry",
    "shoutouts.reorderQueue",
  ],
  twitchChat: ["twitchBroadcast", "shoutouts.listChatters"],
  clips: ["twitchClips"],
  streamInfo: ["streamInfo"],
  goLive: ["goLive"],
} as const satisfies Record<string, readonly string[]>;

export type EngineNamespace = keyof typeof ENGINE_NAMESPACE_MODULES;
