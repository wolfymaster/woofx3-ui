import { Loader2, Store, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { PageIntro } from "@/components/common/page-intro";
import { TechnicalDetails } from "@/components/common/technical-details";
import { PageHeader } from "@/components/layout/page-header";
import { ModuleSettingsSections } from "@/components/modules/module-detail-panel";
import { ModuleOAuthResultBanner } from "@/components/modules/module-oauth-result";
import { ModuleStorageOverLimitAlert } from "@/components/modules/module-storage-usage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useModuleStorageUsage } from "@/engine/hooks/use-module-storage-usage";
import { useInstalledModules, useModuleDetailRequest } from "@/engine/hooks/use-modules";
import type { InstalledModule, ModuleDetail } from "@/engine/types";
import { useLogger } from "@/lib/logger-context";
import { useMarketplaceMode } from "@/lib/marketplace-mode";
import { installedModulePath, MARKETPLACE_PATH, MARKETPLACE_UPLOAD_PATH } from "@/lib/marketplace-route";
import { bareModuleKey } from "@/lib/module-key";

type SettingsLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "loaded"; detail: ModuleDetail };

/**
 * Every installed module's settings on one page, a section per module. A module that
 * declares none has no section; its page, under the same tab, still shows what it adds.
 */
export default function ModulesSettings() {
  const modules = useInstalledModules();
  const mode = useMarketplaceMode();
  const [, navigate] = useLocation();
  const [oauthResult, dismissOauthResult] = mode.useOAuthReturn();
  const { usage: moduleStorage } = useModuleStorageUsage();
  const installed = (modules ?? []).filter((module) => module.status === "installed");

  return (
    <div className="h-full overflow-auto p-6 space-y-4">
      <PageHeader title="Module settings" />
      <PageIntro introId="modules" />
      {moduleStorage && <ModuleStorageOverLimitAlert usage={moduleStorage} className="w-auto" />}
      {oauthResult && <ModuleOAuthResultBanner result={oauthResult} onDismiss={dismissOauthResult} />}
      {modules === undefined && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {modules !== undefined && installed.length === 0 && (
        <Card className="max-w-xl">
          <CardContent className="pt-6 space-y-3">
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
          </CardContent>
        </Card>
      )}
      {installed.map((module) => (
        <ModuleSettingsCard key={module.id} module={module} />
      ))}
    </div>
  );
}

function ModuleSettingsCard({ module }: { module: InstalledModule }) {
  const logger = useLogger();
  const getModuleDetail = useModuleDetailRequest();
  const [, navigate] = useLocation();
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
        logger.error("Could not load module settings", { error: err });
        if (!cancelled) {
          setLoad({ state: "error", message: "Couldn't load settings. Try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [module.id, getModuleDetail, logger]);

  if (load.state === "loaded" && load.detail.manifestSettings.length === 0) {
    return null;
  }

  return (
    <Card className="max-w-2xl" data-testid={`module-settings-${module.id}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{module.name}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(installedModulePath(bareModuleKey(module.moduleKey) ?? module.id))}
        >
          Open
        </Button>
      </CardHeader>
      <CardContent>
        {load.state === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {load.state === "error" && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Couldn't load the settings. Try again.</p>
            <TechnicalDetails text={load.message} />
          </div>
        )}
        {load.state === "loaded" && (
          <ModuleSettingsSections moduleId={load.detail.id} manifestSettings={load.detail.manifestSettings} />
        )}
      </CardContent>
    </Card>
  );
}
