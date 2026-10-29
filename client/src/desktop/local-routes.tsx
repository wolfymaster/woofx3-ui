import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import { ALERT_RUN_ROUTE } from "@/lib/alert-run-route";
import {
  COMMAND_GROUP_EDITOR_ROUTE,
  COMMAND_GROUP_NEW_ROUTE,
  COMMAND_GROUPS_PATH,
  COMMAND_LIST_PATH,
} from "@/lib/command-editor-route";
import { WORKFLOW_RUN_ROUTE } from "@/lib/workflow-run-route";

// The pages local mode serves: those that reach the engine only through its
// gateway. Local mode runs with no Convex client, so a page that loads a
// Convex hook would throw; local-routes.test.ts walks every import from here
// and fails on any that reaches Convex. A page joins this table once nothing
// it loads does.

export interface LocalRoute {
  path: string;
  page: LazyExoticComponent<ComponentType>;
}

const Commands = lazy(() => import("@/pages/commands"));
const CommandGroupEditor = lazy(() => import("@/pages/command-group-editor"));

export const LOCAL_ROUTES: readonly LocalRoute[] = [
  { path: COMMAND_GROUP_NEW_ROUTE, page: CommandGroupEditor },
  { path: COMMAND_GROUP_EDITOR_ROUTE, page: CommandGroupEditor },
  { path: COMMAND_GROUPS_PATH, page: Commands },
  { path: COMMAND_LIST_PATH, page: Commands },
  { path: ALERT_RUN_ROUTE, page: lazy(() => import("@/pages/alert-run")) },
  { path: WORKFLOW_RUN_ROUTE, page: lazy(() => import("@/pages/workflow-run")) },
  { path: "/stream/assets", page: lazy(() => import("@/pages/assets")) },
  { path: "/help/learning", page: lazy(() => import("@/pages/learning")) },
];

/** Where local mode opens, and where a path it does not serve leads back to. */
export const LOCAL_HOME_PATH = COMMAND_LIST_PATH;

/** Whether local mode serves a page at `href`, a path without parameters. */
export function servesLocally(href: string): boolean {
  return LOCAL_ROUTES.some((route) => route.path === href);
}
