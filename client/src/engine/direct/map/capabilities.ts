import type { EngineCapability, EngineCapabilityReport } from "@/engine/types";

/** Every id the gateway contract gates on; keyed by the contract's union, so the two cannot drift. */
const GATED: { readonly [C in EngineCapability]: true } = {
  "alerts.compositionLayout": true,
  "alerts.queueControls": true,
  "analytics.aggregates": true,
  "analytics.gauges": true,
  "analytics.sessionEvents": true,
  "analytics.sessions": true,
  "assets.sizedUploads": true,
  "compositions.alerts": true,
  "compositions.preview": true,
  "config.bundles": true,
  "events.log": true,
  "modules.files": true,
  "modules.localEndpoints": true,
  "modules.marketplaceInstall": true,
  "modules.oauth": true,
  "modules.storageUsage": true,
  "obs.control": true,
  "obs.status": true,
  "scenes.behaviors": true,
  "scenes.editorSessions": true,
  "scenes.editorSync": true,
  "scenes.repair": true,
  "twitch.ads": true,
  "twitch.chat": true,
  "twitch.clips": true,
  "twitch.dashboardTokens": true,
  "twitch.moderation": true,
  "twitch.pins": true,
  "twitch.streamInfo": true,
  "widgets.themes": true,
  "workflow.conditionListReferences": true,
  "workflow.delayWait": true,
  "workflow.dryRun": true,
  "workflow.health": true,
  "workflow.realCancel": true,
  "workflow.reservedSubjects": true,
  "workflow.testRunOptions": true,
  "workflow.viewerFacts": true,
};

function isGated(id: string): id is EngineCapability {
  return Object.hasOwn(GATED, id);
}

/**
 * The report screens gate on, from the ids an engine listed: the ones the
 * contract knows, sorted and unique. An engine the direct gateway connects
 * to always reports its capabilities, so it is never legacy.
 */
export function toCapabilityReport(ids: readonly string[]): EngineCapabilityReport {
  return { legacy: false, capabilities: [...new Set(ids.filter(isGated))].sort() };
}
