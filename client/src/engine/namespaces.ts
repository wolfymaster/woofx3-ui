/**
 * The domains the UI reaches the engine through, one `EngineGateway` namespace
 * each, and the Convex modules that serve each domain today.
 *
 * A module listed here relays to the engine or mirrors engine state, so only
 * the Convex adapter (client/src/engine/convex/) may call it; boundary.test.ts
 * holds every other file to that. An entry naming a function (`macros.run`)
 * claims that function alone, leaving the rest of the module cloud-owned.
 *
 * Cloud-owned modules (accounts, instances, provisioning, marketplace, Twitch
 * Helix proxies, dashboard preferences) are not engine access and stay out.
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
  modules: ["moduleEngine", "moduleSettingsActions", "moduleFiles", "moduleDetail"],
  scenes: ["scenes", "sceneActions", "sceneWidgets"],
  requests: ["transientEvents"],
  workflows: ["workflows", "workflowActions", "workflowRuns", "workflowHealth", "workflowCatalog"],
  macros: ["macros.run"],
  streamOps: [
    // The rest of streamRecap asks Twitch for clips and markers.
    "streamRecap.loadEngineDetail",
    "streamRecap.loadTimelineEvents",
    "streamRecap.refreshOpenSession",
    // The rest of supporters asks Twitch for a viewer or reads the channel's Twitch link.
    "supporters.listStreams",
    "supporters.leaderboard",
    "supporters.viewerTotals",
    "debug",
  ],
  config: [
    // configBackup.access is the caller's role, read from Convex.
    "configBackup.exportConfig",
    "configBackup.previewImport",
    "configBackup.importConfig",
    "storage",
    "fieldOptions",
  ],
} as const satisfies Record<string, readonly string[]>;

export type EngineNamespace = keyof typeof ENGINE_NAMESPACE_MODULES;
