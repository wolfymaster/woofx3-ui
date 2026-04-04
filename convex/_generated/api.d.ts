/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as actionDefinitions from "../actionDefinitions.js";
import type * as alertDescriptors from "../alertDescriptors.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as browserSource from "../browserSource.js";
import type * as chatCommands from "../chatCommands.js";
import type * as dashboardLayouts from "../dashboardLayouts.js";
import type * as folders from "../folders.js";
import type * as http from "../http.js";
import type * as installedModules from "../installedModules.js";
import type * as instances from "../instances.js";
import type * as lib_storage_config from "../lib/storage/config.js";
import type * as lib_storage_convexAdapter from "../lib/storage/convexAdapter.js";
import type * as lib_storage_index from "../lib/storage/index.js";
import type * as lib_storage_localAdapter from "../lib/storage/localAdapter.js";
import type * as lib_storage_r2Adapter from "../lib/storage/r2Adapter.js";
import type * as lib_storage_types from "../lib/storage/types.js";
import type * as logger from "../logger.js";
import type * as migrations_backfillAssetKeys from "../migrations/backfillAssetKeys.js";
import type * as moduleRepository from "../moduleRepository.js";
import type * as moduleWidgets from "../moduleWidgets.js";
import type * as obsCommands from "../obsCommands.js";
import type * as sceneSlots from "../sceneSlots.js";
import type * as scenes from "../scenes.js";
import type * as seeds_triggerActions from "../seeds/triggerActions.js";
import type * as triggerDefinitions from "../triggerDefinitions.js";
import type * as twitchAuth from "../twitchAuth.js";
import type * as users from "../users.js";
import type * as workflowTemplates from "../workflowTemplates.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  actionDefinitions: typeof actionDefinitions;
  alertDescriptors: typeof alertDescriptors;
  assets: typeof assets;
  auth: typeof auth;
  browserSource: typeof browserSource;
  chatCommands: typeof chatCommands;
  dashboardLayouts: typeof dashboardLayouts;
  folders: typeof folders;
  http: typeof http;
  installedModules: typeof installedModules;
  instances: typeof instances;
  "lib/storage/config": typeof lib_storage_config;
  "lib/storage/convexAdapter": typeof lib_storage_convexAdapter;
  "lib/storage/index": typeof lib_storage_index;
  "lib/storage/localAdapter": typeof lib_storage_localAdapter;
  "lib/storage/r2Adapter": typeof lib_storage_r2Adapter;
  "lib/storage/types": typeof lib_storage_types;
  logger: typeof logger;
  "migrations/backfillAssetKeys": typeof migrations_backfillAssetKeys;
  moduleRepository: typeof moduleRepository;
  moduleWidgets: typeof moduleWidgets;
  obsCommands: typeof obsCommands;
  sceneSlots: typeof sceneSlots;
  scenes: typeof scenes;
  "seeds/triggerActions": typeof seeds_triggerActions;
  triggerDefinitions: typeof triggerDefinitions;
  twitchAuth: typeof twitchAuth;
  users: typeof users;
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
