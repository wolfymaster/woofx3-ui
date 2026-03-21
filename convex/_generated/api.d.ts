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
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as chatCommands from "../chatCommands.js";
import type * as dashboardLayouts from "../dashboardLayouts.js";
import type * as http from "../http.js";
import type * as installedModules from "../installedModules.js";
import type * as instances from "../instances.js";
import type * as moduleRepository from "../moduleRepository.js";
import type * as users from "../users.js";
import type * as workflowTemplates from "../workflowTemplates.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  assets: typeof assets;
  auth: typeof auth;
  chatCommands: typeof chatCommands;
  dashboardLayouts: typeof dashboardLayouts;
  http: typeof http;
  installedModules: typeof installedModules;
  instances: typeof instances;
  moduleRepository: typeof moduleRepository;
  users: typeof users;
  workflowTemplates: typeof workflowTemplates;
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
