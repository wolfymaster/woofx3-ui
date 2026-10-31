import { AlertCircle, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ManageResourcesTab,
  ModuleAccessSummary,
  ModuleDefinitions,
  ModuleReadme,
  ModuleSettingsSections,
} from "@/components/modules/module-detail-panel";
import { ModuleFilesTab } from "@/components/modules/module-files";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModuleDetail } from "@/engine/types";
import { useModuleFiles } from "@/hooks/use-module-files";
import { localEndpointsToApprove, permissionsToApprove } from "@/lib/module-permissions";
import { isNewerVersion } from "@/lib/utils";

const LISTING_TABS = ["overview", "contents", "files", "settings", "resources"] as const;
type ListingTab = (typeof LISTING_TABS)[number];

export type ModuleDetailLoad =
  | { status: "loading" }
  | { status: "ready"; detail: ModuleDetail }
  | { status: "error"; message: string };

interface ListingModuleTabsProps {
  load: ModuleDetailLoad;
  onRetry: () => void;
  /** The catalog's own sections for this listing, shown under the README. */
  children?: React.ReactNode;
}

/**
 * The body of a module or theme listing: what the module is, what it
 * declares, its files and, once installed, its settings and resources.
 *
 * The tab lives in the URL (`?tab=`), so a link, a reload or a return from a
 * connection flow opens the same tab.
 */
export function ListingModuleTabs({ load, onRetry, children }: ListingModuleTabsProps) {
  const detail = load.status === "ready" ? load.detail : null;
  const tabs = availableTabs(detail);
  const [tab, setTab] = useListingTab(tabs);
  // One loader for both the file browser and the function rows, so moving
  // between the tabs does not list the files again.
  const files = useModuleFiles({
    moduleId: detail?.id,
    isInstalled: detail?.isInstalled ?? false,
    version: detail?.version ?? "",
  });

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ListingTab)} className="space-y-6">
      <TabsList className="flex h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b bg-transparent p-0">
        <PageTab value="overview">Overview</PageTab>
        <PageTab value="contents" disabled={!detail}>
          What's inside
          {detail && <TabCount count={definitionCount(detail)} />}
        </PageTab>
        <PageTab value="files" disabled={!detail}>
          Files
        </PageTab>
        {tabs.includes("settings") && <PageTab value="settings">Settings</PageTab>}
        {tabs.includes("resources") && <PageTab value="resources">Resources</PageTab>}
      </TabsList>

      <TabsContent value="overview" className="mt-0">
        <OverviewTab load={load} onRetry={onRetry}>
          {children}
        </OverviewTab>
      </TabsContent>

      {detail && (
        <>
          <TabsContent value="contents" className="mt-0">
            <ModuleDefinitions
              triggers={detail.triggers}
              actions={detail.actions}
              functions={detail.functions}
              widgets={detail.widgets}
              workflows={detail.workflows}
              files={files}
            />
          </TabsContent>
          <TabsContent value="files" className="mt-0">
            <ModuleFilesTab files={files} />
          </TabsContent>
          {tabs.includes("settings") && (
            <TabsContent value="settings" className="mt-0">
              <ModuleSettingsSections moduleId={detail.id} manifestSettings={detail.manifestSettings} />
            </TabsContent>
          )}
          {tabs.includes("resources") && (
            <TabsContent value="resources" className="mt-0">
              <ManageResourcesTab
                moduleDbId={detail.moduleDbId}
                moduleName={detail.id}
                manifestResourceKinds={detail.manifestResourceKinds}
              />
            </TabsContent>
          )}
        </>
      )}
    </Tabs>
  );
}

function availableTabs(detail: ModuleDetail | null): ListingTab[] {
  const tabs: ListingTab[] = ["overview", "contents", "files"];
  if (detail?.isInstalled) {
    tabs.push("settings");
    if (detail.manifestResourceKinds.length > 0) {
      tabs.push("resources");
    }
  }
  return tabs;
}

/**
 * The tab named by `?tab=`, falling back to the overview when it names a tab
 * this listing does not have (yet): settings only appear once the module is
 * installed and its detail has loaded.
 */
function useListingTab(tabs: ListingTab[]): [ListingTab, (tab: ListingTab) => void] {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const tab = tabs.find((candidate) => candidate === requested) ?? "overview";

  const setTab = useCallback(
    (next: ListingTab) => {
      const params = new URLSearchParams(search);
      if (next === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const query = params.toString();
      navigate(query ? `${location}?${query}` : location, { replace: true });
    },
    [location, navigate, search]
  );
  return [tab, setTab];
}

function PageTab({ value, disabled, children }: { value: ListingTab; disabled?: boolean; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      disabled={disabled}
      className="-mb-px gap-2 rounded-none border-b-2 border-transparent px-0 pb-3 pt-1 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

function TabCount({ count }: { count: number }) {
  return <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>;
}

function definitionCount(detail: ModuleDetail): number {
  return (
    detail.triggers.length +
    detail.actions.length +
    detail.functions.length +
    detail.widgets.length +
    detail.workflows.length
  );
}

function OverviewTab({
  load,
  onRetry,
  children,
}: {
  load: ModuleDetailLoad;
  onRetry: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-8">
        <div className="max-w-[68ch]">
          {load.status === "loading" && <ReadmeSkeleton />}
          {load.status === "error" && <DetailError message={load.message} onRetry={onRetry} />}
          {load.status === "ready" && <ModuleReadme readme={load.detail.readme} />}
        </div>
        {children}
      </div>
      {load.status === "ready" && <OverviewRail detail={load.detail} />}
    </div>
  );
}

function OverviewRail({ detail }: { detail: ModuleDetail }) {
  const updateAvailable =
    detail.isInstalled && detail.latestVersion !== undefined && isNewerVersion(detail.latestVersion, detail.version);
  const updatePermissions = useMemo(
    () =>
      updateAvailable && detail.latestPermissions
        ? permissionsToApprove(detail.latestPermissions, detail.permissions ?? [])
        : [],
    [updateAvailable, detail.latestPermissions, detail.permissions]
  );
  const updateLocalEndpoints = useMemo(
    () =>
      updateAvailable && detail.latestLocalEndpoints
        ? localEndpointsToApprove(detail.latestLocalEndpoints, detail.localEndpoints ?? [])
        : [],
    [updateAvailable, detail.latestLocalEndpoints, detail.localEndpoints]
  );

  return (
    <aside className="space-y-6 lg:border-l lg:pl-6">
      <ModuleAccessSummary
        permissions={detail.permissions}
        localEndpoints={detail.localEndpoints}
        updatePermissions={updatePermissions}
        updateLocalEndpoints={updateLocalEndpoints}
        latestVersion={detail.latestVersion}
      />
      <dl className="space-y-3 text-sm">
        <Fact label="Module id">
          <span className="break-all font-mono text-xs">{detail.id}</span>
        </Fact>
        {detail.isInstalled ? (
          <Fact label="Installed version">
            v{detail.version}
            {updateAvailable && (
              <span className="block text-xs text-amber-600 dark:text-amber-400">
                v{detail.latestVersion} is available
              </span>
            )}
          </Fact>
        ) : (
          <Fact label="Version">v{detail.version}</Fact>
        )}
        {detail.category && <Fact label="Category">{detail.category}</Fact>}
      </dl>
    </aside>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function ReadmeSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function DetailError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Couldn't load this module's README and details
      </p>
      <p className="break-words text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
