import { Loader2, Store, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { PageIntro } from "@/components/common/page-intro";
import { ListDetail } from "@/components/layout/list-detail";
import { InstalledModuleRail, moduleRouteId } from "@/components/modules/installed-module-rail";
import { ModuleSettingsSections } from "@/components/modules/module-detail-panel";
import { ModuleOAuthResultBanner } from "@/components/modules/module-oauth-result";
import { ModuleStorageOverLimitAlert } from "@/components/modules/module-storage-usage";
import { Button } from "@/components/ui/button";
import { useModuleStorageUsage } from "@/engine/hooks/use-module-storage-usage";
import { useInstalledModules, useModuleDetailRequest } from "@/engine/hooks/use-modules";
import type { InstalledModule, ModuleDetail } from "@/engine/types";
import { useMarketplaceMode } from "@/lib/marketplace-mode";
import {
  installedModulePath,
  MARKETPLACE_PATH,
  MARKETPLACE_UPLOAD_PATH,
  MODULE_SETTINGS_PATH,
  moduleSettingsPath,
} from "@/lib/marketplace-route";

type SettingsLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "loaded"; detail: ModuleDetail };

/**
 * One module's settings at a time, picked from a rail of the installed modules, so the
 * page stays as short as one module however many are installed. With no module in the
 * route it opens the first one; a phone shows the rail until one is picked.
 */
export default function ModulesSettings() {
  const modules = useInstalledModules();
  const mode = useMarketplaceMode();
  const [location, navigate] = useLocation();
  const [oauthResult, dismissOauthResult] = mode.useOAuthReturn();
  const { usage: moduleStorage } = useModuleStorageUsage();
  const installed = (modules ?? []).filter((module) => module.status === "installed");
  const segments = location.split("/").filter(Boolean);
  const routeModuleId = segments.length >= 3 ? decodeURIComponent(segments[2]) : undefined;
  const selected = installed.find((m) => routeModuleId === moduleRouteId(m) || routeModuleId === m.id) ?? installed[0];

  const banners = (
    <>
      {moduleStorage && <ModuleStorageOverLimitAlert usage={moduleStorage} className="w-auto" />}
      {oauthResult && <ModuleOAuthResultBanner result={oauthResult} onDismiss={dismissOauthResult} />}
    </>
  );

  if (modules === undefined) {
    return <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />;
  }

  if (installed.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-xl">
        <PageIntro introId="modules" />
        {banners}
        <p className="font-medium">No modules installed yet</p>
        <p className="text-sm text-muted-foreground">
          {mode.uploads
            ? "Add one from the marketplace, or upload a module you made yourself."
            : "Add one from the marketplace."}
        </p>
        <div className="flex flex-wrap gap-2">
          {mode.uploads && (
            <Button size="sm" onClick={() => navigate(MARKETPLACE_UPLOAD_PATH)}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Upload a module
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate(MARKETPLACE_PATH)}>
            <Store className="h-3.5 w-3.5 mr-1.5" />
            Browse the marketplace
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ListDetail
      hasSelection={routeModuleId !== undefined}
      back={{ href: MODULE_SETTINGS_PATH, label: "modules" }}
      list={
        <InstalledModuleRail
          title="Module settings"
          modules={installed}
          selectedId={selected.id === routeModuleId ? selected.id : moduleRouteId(selected)}
          hrefFor={moduleSettingsPath}
        />
      }
      detail={
        <div className="h-full min-w-0 flex-1 overflow-auto p-6 space-y-4">
          {banners}
          <ModuleSettingsPane key={selected.id} module={selected} />
        </div>
      }
    />
  );
}

function ModuleSettingsPane({ module }: { module: InstalledModule }) {
  const getModuleDetail = useModuleDetailRequest();
  const [load, setLoad] = useState<SettingsLoad>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    getModuleDetail(module.id)
      .then((detail) => {
        if (!cancelled) {
          setLoad({ state: "loaded", detail });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoad({ state: "error", message: err instanceof Error ? err.message : "Failed to load settings." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [module.id, getModuleDetail]);

  return (
    <section className="max-w-2xl space-y-5" data-testid={`module-settings-${module.id}`}>
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate">{module.name}</h1>
          {module.description && <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={installedModulePath(moduleRouteId(module))}>Open module</Link>
        </Button>
      </header>
      {load.state === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {load.state === "error" && <p className="text-sm text-destructive">{load.message}</p>}
      {load.state === "loaded" && load.detail.manifestSettings.length === 0 && (
        <p className="text-sm text-muted-foreground">{module.name} has no settings to change.</p>
      )}
      {load.state === "loaded" && load.detail.manifestSettings.length > 0 && (
        <ModuleSettingsSections moduleId={load.detail.id} manifestSettings={load.detail.manifestSettings} />
      )}
    </section>
  );
}
