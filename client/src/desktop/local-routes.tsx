import { lazy, type ReactNode } from "react";
import { ALERT_LIBRARY_EDITOR_ROUTE } from "@/lib/alert-editor-route";
import { ALERT_RUN_ROUTE } from "@/lib/alert-run-route";
import {
  COMMAND_EDITOR_ROUTE,
  COMMAND_GROUP_EDITOR_ROUTE,
  COMMAND_GROUP_NEW_ROUTE,
  COMMAND_GROUPS_PATH,
  COMMAND_LIST_PATH,
  COMMAND_NEW_ROUTE,
} from "@/lib/command-editor-route";
import {
  MARKETPLACE_AUTHOR_ROUTE,
  MARKETPLACE_INSTALLED_MODULE_ROUTE,
  MARKETPLACE_INSTALLED_PATH,
  MARKETPLACE_LISTING_ROUTE,
  MARKETPLACE_PATH,
} from "@/lib/marketplace-route";
import { builtInKindRoutes } from "@/lib/resource-kind-route";
import { STREAM_RECAP_ROUTE, STREAM_RECAPS_PATH } from "@/lib/stream-recap-route";
import { WORKFLOW_RUN_ROUTE } from "@/lib/workflow-run-route";

// The pages local mode serves: those that reach the engine only through its
// gateway. Local mode runs with no Convex client, so a page that loads a
// Convex hook would throw; local-routes.test.ts walks every import from here
// and fails on any that reaches Convex. A page joins this table once nothing
// it loads does.

export interface LocalRoute {
  path: string;
  render: (params: Record<string, string | undefined>) => ReactNode;
}

const AdminAppearance = lazy(() => import("@/pages/admin/appearance"));
const AdminIntegrations = lazy(() => import("@/pages/admin/integrations"));
const Alerts = lazy(() => import("@/pages/alerts"));
const AlertRun = lazy(() => import("@/pages/alert-run"));
const Assets = lazy(() => import("@/pages/assets"));
const CommandEditor = lazy(() => import("@/pages/command-editor"));
const CommandGroupEditor = lazy(() => import("@/pages/command-group-editor"));
const Commands = lazy(() => import("@/pages/commands"));
const Dashboard = lazy(() => import("./LocalDashboard"));
const GoLive = lazy(() => import("@/pages/go-live"));
const Learning = lazy(() => import("@/pages/learning"));
const Logs = lazy(() => import("@/pages/logs"));
const Marketplace = lazy(() => import("@/pages/marketplace"));
const MarketplaceAuthor = lazy(() => import("@/pages/marketplace-author"));
const MarketplaceListing = lazy(() => import("@/pages/marketplace-listing"));
const Modules = lazy(() => import("@/pages/modules"));
const LibraryAlertEditor = lazy(() => import("@/pages/library-alert-editor"));
const ResourceKind = lazy(() => import("@/pages/resource-kind"));
const Scenes = lazy(() => import("@/pages/scenes"));
const StarterPacks = lazy(() => import("@/pages/starter-packs"));
const StreamRecap = lazy(() => import("@/pages/stream-recap"));
const StreamRecaps = lazy(() => import("@/pages/stream-recaps"));
const WorkflowRun = lazy(() => import("@/pages/workflow-run"));
const Workflows = lazy(() => import("@/pages/workflows"));

/** A kind's page and its instances' pages below it. */
function resourceKindRoutes(): LocalRoute[] {
  const builtIn = builtInKindRoutes().flatMap(({ moduleName, kind, path }) =>
    [path, `${path}/*`].map((pattern) => ({
      path: pattern,
      render: () => <ResourceKind moduleName={moduleName} kind={kind} />,
    }))
  );
  const byName = ["/stream/resources/:module/:kind", "/stream/resources/:module/:kind/*"].map((pattern) => ({
    path: pattern,
    render: (params: Record<string, string | undefined>) => (
      <ResourceKind moduleName={params.module ?? ""} kind={params.kind ?? ""} />
    ),
  }));
  return [...builtIn, ...byName];
}

/** In the hosted app's order: fixed segments before the parameters that would otherwise match them. */
export const LOCAL_ROUTES: readonly LocalRoute[] = [
  { path: "/", render: () => <Dashboard /> },
  { path: "/stream/alerts", render: () => <Alerts /> },
  { path: "/stream/alerts/*", render: () => <Alerts /> },
  { path: ALERT_LIBRARY_EDITOR_ROUTE, render: () => <LibraryAlertEditor /> },
  { path: ALERT_RUN_ROUTE, render: () => <AlertRun /> },
  { path: COMMAND_GROUP_NEW_ROUTE, render: () => <CommandGroupEditor /> },
  { path: COMMAND_GROUP_EDITOR_ROUTE, render: () => <CommandGroupEditor /> },
  { path: COMMAND_GROUPS_PATH, render: () => <Commands /> },
  { path: COMMAND_NEW_ROUTE, render: () => <CommandEditor /> },
  { path: COMMAND_EDITOR_ROUTE, render: () => <CommandEditor /> },
  { path: COMMAND_LIST_PATH, render: () => <Commands /> },
  ...resourceKindRoutes(),
  { path: STREAM_RECAPS_PATH, render: () => <StreamRecaps /> },
  { path: STREAM_RECAP_ROUTE, render: () => <StreamRecap /> },
  { path: "/stream/scenes", render: () => <Scenes /> },
  { path: "/stream/scenes/:id", render: () => <Scenes /> },
  { path: "/stream/workflows", render: () => <Workflows /> },
  { path: "/stream/workflows/new", render: () => <Workflows /> },
  { path: WORKFLOW_RUN_ROUTE, render: () => <WorkflowRun /> },
  { path: "/stream/workflows/:id", render: () => <Workflows /> },
  { path: "/stream/workflows/:id/edit", render: () => <Workflows /> },
  { path: "/stream/assets", render: () => <Assets /> },
  { path: "/stream/go-live", render: () => <GoLive /> },
  { path: "/stream/starter-packs", render: () => <StarterPacks /> },
  { path: MARKETPLACE_AUTHOR_ROUTE, render: () => <MarketplaceAuthor /> },
  { path: MARKETPLACE_LISTING_ROUTE, render: () => <MarketplaceListing /> },
  { path: MARKETPLACE_PATH, render: () => <Marketplace /> },
  { path: MARKETPLACE_INSTALLED_PATH, render: () => <Modules /> },
  { path: MARKETPLACE_INSTALLED_MODULE_ROUTE, render: () => <Modules /> },
  { path: "/help/learning", render: () => <Learning /> },
  { path: "/help/logs", render: () => <Logs /> },
  { path: "/admin/appearance", render: () => <AdminAppearance /> },
  { path: "/admin/integrations", render: () => <AdminIntegrations /> },
];

/** Where local mode opens, and where a path it does not serve leads back to. */
export const LOCAL_HOME_PATH = "/";

/** Whether local mode serves a page at `href`, a path without parameters. */
export function servesLocally(href: string): boolean {
  return LOCAL_ROUTES.some((route) => route.path === href);
}
