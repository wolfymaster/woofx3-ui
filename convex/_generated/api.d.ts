/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountMembers from "../accountMembers.js";
import type * as accounts from "../accounts.js";
import type * as actionDefinitions from "../actionDefinitions.js";
import type * as activityPanel from "../activityPanel.js";
import type * as alertDescriptors from "../alertDescriptors.js";
import type * as alertLog from "../alertLog.js";
import type * as auth from "../auth.js";
import type * as browserSource from "../browserSource.js";
import type * as chatCommandActions from "../chatCommandActions.js";
import type * as chatCommandGroups from "../chatCommandGroups.js";
import type * as chatCommands from "../chatCommands.js";
import type * as crons from "../crons.js";
import type * as dashboardLayouts from "../dashboardLayouts.js";
import type * as dashboardNotes from "../dashboardNotes.js";
import type * as debug from "../debug.js";
import type * as engineAlerts from "../engineAlerts.js";
import type * as engineEventLog from "../engineEventLog.js";
import type * as engineHealth from "../engineHealth.js";
import type * as engineInfo from "../engineInfo.js";
import type * as engineSync from "../engineSync.js";
import type * as engineSyncInternal from "../engineSyncInternal.js";
import type * as fieldOptions from "../fieldOptions.js";
import type * as http from "../http.js";
import type * as instanceLiveState from "../instanceLiveState.js";
import type * as instances from "../instances.js";
import type * as invitations from "../invitations.js";
import type * as lib_browserSourceHtml from "../lib/browserSourceHtml.js";
import type * as lib_canonicalRef from "../lib/canonicalRef.js";
import type * as lib_dollarKeys from "../lib/dollarKeys.js";
import type * as lib_engineInstanceUrl from "../lib/engineInstanceUrl.js";
import type * as lib_engineSync_config from "../lib/engineSync/config.js";
import type * as lib_engineSync_steps from "../lib/engineSync/steps.js";
import type * as lib_engineSync_steps_actions from "../lib/engineSync/steps/actions.js";
import type * as lib_engineSync_steps_commands from "../lib/engineSync/steps/commands.js";
import type * as lib_engineSync_steps_functions from "../lib/engineSync/steps/functions.js";
import type * as lib_engineSync_steps_groups from "../lib/engineSync/steps/groups.js";
import type * as lib_engineSync_steps_resources from "../lib/engineSync/steps/resources.js";
import type * as lib_engineSync_steps_scenes from "../lib/engineSync/steps/scenes.js";
import type * as lib_engineSync_steps_triggers from "../lib/engineSync/steps/triggers.js";
import type * as lib_engineSync_steps_widgets from "../lib/engineSync/steps/widgets.js";
import type * as lib_engineSync_steps_workflows from "../lib/engineSync/steps/workflows.js";
import type * as lib_moduleKey from "../lib/moduleKey.js";
import type * as lib_pkce from "../lib/pkce.js";
import type * as lib_sceneSerialization from "../lib/sceneSerialization.js";
import type * as lib_spotifyIntegrationScopes from "../lib/spotifyIntegrationScopes.js";
import type * as lib_teamAccess from "../lib/teamAccess.js";
import type * as lib_twitchIntegrationScopes from "../lib/twitchIntegrationScopes.js";
import type * as lib_widgetKey from "../lib/widgetKey.js";
import type * as logger from "../logger.js";
import type * as marketplace from "../marketplace.js";
import type * as migrations_backfillAccountMembers from "../migrations/backfillAccountMembers.js";
import type * as moduleAssets from "../moduleAssets.js";
import type * as moduleDetail from "../moduleDetail.js";
import type * as moduleEngine from "../moduleEngine.js";
import type * as moduleFeatured from "../moduleFeatured.js";
import type * as moduleFunctions from "../moduleFunctions.js";
import type * as moduleIntegrationState from "../moduleIntegrationState.js";
import type * as moduleManifestSync from "../moduleManifestSync.js";
import type * as moduleRepository from "../moduleRepository.js";
import type * as moduleResourceActions from "../moduleResourceActions.js";
import type * as moduleResourceInstances from "../moduleResourceInstances.js";
import type * as moduleSettingsActions from "../moduleSettingsActions.js";
import type * as moduleWebhook from "../moduleWebhook.js";
import type * as moduleWidgets from "../moduleWidgets.js";
import type * as obsCommands from "../obsCommands.js";
import type * as obsSceneConfigs from "../obsSceneConfigs.js";
import type * as platformRealtime from "../platformRealtime.js";
import type * as registration from "../registration.js";
import type * as resources from "../resources.js";
import type * as sceneActions from "../sceneActions.js";
import type * as sceneSlots from "../sceneSlots.js";
import type * as sceneWidgets from "../sceneWidgets.js";
import type * as scenes from "../scenes.js";
import type * as seeds_triggerActions from "../seeds/triggerActions.js";
import type * as spotifyIntegration from "../spotifyIntegration.js";
import type * as storage from "../storage.js";
import type * as streamGoals from "../streamGoals.js";
import type * as streamStatus from "../streamStatus.js";
import type * as transientEvents from "../transientEvents.js";
import type * as triggerDefinitions from "../triggerDefinitions.js";
import type * as twitchAuth from "../twitchAuth.js";
import type * as twitchBroadcast from "../twitchBroadcast.js";
import type * as twitchClips from "../twitchClips.js";
import type * as twitchIntegration from "../twitchIntegration.js";
import type * as users from "../users.js";
import type * as webhookAuth from "../webhookAuth.js";
import type * as workflowActions from "../workflowActions.js";
import type * as workflowCatalog from "../workflowCatalog.js";
import type * as workflowCatalogContext from "../workflowCatalogContext.js";
import type * as workflowInternal from "../workflowInternal.js";
import type * as workflowTemplates from "../workflowTemplates.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountMembers: typeof accountMembers;
  accounts: typeof accounts;
  actionDefinitions: typeof actionDefinitions;
  activityPanel: typeof activityPanel;
  alertDescriptors: typeof alertDescriptors;
  alertLog: typeof alertLog;
  auth: typeof auth;
  browserSource: typeof browserSource;
  chatCommandActions: typeof chatCommandActions;
  chatCommandGroups: typeof chatCommandGroups;
  chatCommands: typeof chatCommands;
  crons: typeof crons;
  dashboardLayouts: typeof dashboardLayouts;
  dashboardNotes: typeof dashboardNotes;
  debug: typeof debug;
  engineAlerts: typeof engineAlerts;
  engineEventLog: typeof engineEventLog;
  engineHealth: typeof engineHealth;
  engineInfo: typeof engineInfo;
  engineSync: typeof engineSync;
  engineSyncInternal: typeof engineSyncInternal;
  fieldOptions: typeof fieldOptions;
  http: typeof http;
  instanceLiveState: typeof instanceLiveState;
  instances: typeof instances;
  invitations: typeof invitations;
  "lib/browserSourceHtml": typeof lib_browserSourceHtml;
  "lib/canonicalRef": typeof lib_canonicalRef;
  "lib/dollarKeys": typeof lib_dollarKeys;
  "lib/engineInstanceUrl": typeof lib_engineInstanceUrl;
  "lib/engineSync/config": typeof lib_engineSync_config;
  "lib/engineSync/steps": typeof lib_engineSync_steps;
  "lib/engineSync/steps/actions": typeof lib_engineSync_steps_actions;
  "lib/engineSync/steps/commands": typeof lib_engineSync_steps_commands;
  "lib/engineSync/steps/functions": typeof lib_engineSync_steps_functions;
  "lib/engineSync/steps/groups": typeof lib_engineSync_steps_groups;
  "lib/engineSync/steps/resources": typeof lib_engineSync_steps_resources;
  "lib/engineSync/steps/scenes": typeof lib_engineSync_steps_scenes;
  "lib/engineSync/steps/triggers": typeof lib_engineSync_steps_triggers;
  "lib/engineSync/steps/widgets": typeof lib_engineSync_steps_widgets;
  "lib/engineSync/steps/workflows": typeof lib_engineSync_steps_workflows;
  "lib/moduleKey": typeof lib_moduleKey;
  "lib/pkce": typeof lib_pkce;
  "lib/sceneSerialization": typeof lib_sceneSerialization;
  "lib/spotifyIntegrationScopes": typeof lib_spotifyIntegrationScopes;
  "lib/teamAccess": typeof lib_teamAccess;
  "lib/twitchIntegrationScopes": typeof lib_twitchIntegrationScopes;
  "lib/widgetKey": typeof lib_widgetKey;
  logger: typeof logger;
  marketplace: typeof marketplace;
  "migrations/backfillAccountMembers": typeof migrations_backfillAccountMembers;
  moduleAssets: typeof moduleAssets;
  moduleDetail: typeof moduleDetail;
  moduleEngine: typeof moduleEngine;
  moduleFeatured: typeof moduleFeatured;
  moduleFunctions: typeof moduleFunctions;
  moduleIntegrationState: typeof moduleIntegrationState;
  moduleManifestSync: typeof moduleManifestSync;
  moduleRepository: typeof moduleRepository;
  moduleResourceActions: typeof moduleResourceActions;
  moduleResourceInstances: typeof moduleResourceInstances;
  moduleSettingsActions: typeof moduleSettingsActions;
  moduleWebhook: typeof moduleWebhook;
  moduleWidgets: typeof moduleWidgets;
  obsCommands: typeof obsCommands;
  obsSceneConfigs: typeof obsSceneConfigs;
  platformRealtime: typeof platformRealtime;
  registration: typeof registration;
  resources: typeof resources;
  sceneActions: typeof sceneActions;
  sceneSlots: typeof sceneSlots;
  sceneWidgets: typeof sceneWidgets;
  scenes: typeof scenes;
  "seeds/triggerActions": typeof seeds_triggerActions;
  spotifyIntegration: typeof spotifyIntegration;
  storage: typeof storage;
  streamGoals: typeof streamGoals;
  streamStatus: typeof streamStatus;
  transientEvents: typeof transientEvents;
  triggerDefinitions: typeof triggerDefinitions;
  twitchAuth: typeof twitchAuth;
  twitchBroadcast: typeof twitchBroadcast;
  twitchClips: typeof twitchClips;
  twitchIntegration: typeof twitchIntegration;
  users: typeof users;
  webhookAuth: typeof webhookAuth;
  workflowActions: typeof workflowActions;
  workflowCatalog: typeof workflowCatalog;
  workflowCatalogContext: typeof workflowCatalogContext;
  workflowInternal: typeof workflowInternal;
  workflowTemplates: typeof workflowTemplates;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
