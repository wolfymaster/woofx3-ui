import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ResolvedSetupPlatforms, SetupPlatform } from "@convex/lib/setupPlatforms";
import type { SetupStatus } from "@convex/setup";
import { useAction, useMutation } from "convex/react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { describePermissions } from "@/lib/module-permissions";
import { cn } from "@/lib/utils";

interface PlatformsStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
  onContinue: () => void;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: ResolvedSetupPlatforms };

/** The platforms to start with checked: the saved choice once there is one, otherwise the curated defaults. */
function initialSelection(platforms: readonly SetupPlatform[], status: SetupStatus): Set<string> {
  if (status.platformsChosenAt !== null) {
    const saved = new Set(status.platforms.map((platform) => platform.marketplaceModuleId));
    return new Set(
      platforms
        .filter((platform) => platform.required || saved.has(platform.marketplaceModuleId))
        .map((platform) => platform.marketplaceModuleId)
    );
  }
  return new Set(
    platforms.filter((platform) => platform.defaultSelected).map((platform) => platform.marketplaceModuleId)
  );
}

/**
 * Setup's first page: which platform modules to install. Checking a platform
 * approves the permissions listed under it; those are what the install later
 * accepts, and a build that asks for more is brought back for approval.
 */
export function PlatformsStep({ instanceId, status, onContinue }: PlatformsStepProps) {
  const listForSetup = useAction(api.setupPlatformsActions.listForSetup);
  const choosePlatforms = useMutation(api.setup.choosePlatforms);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Null until the user changes a box; until then the selection follows the saved choice or the defaults.
  const [edited, setEdited] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const data = await listForSetup({ instanceId });
      setLoad({ state: "ready", data });
    } catch (err) {
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [listForSetup, instanceId]);

  useEffect(() => {
    void fetchPlatforms();
  }, [fetchPlatforms]);

  if (load.state === "loading") {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading platforms…
      </div>
    );
  }

  if (load.state === "error" || load.data.unavailableRequired.length > 0) {
    const message =
      load.state === "error"
        ? load.message
        : "A platform woofx3 needs is not available right now, so setup cannot continue.";
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {message}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void fetchPlatforms()}
          data-testid="button-retry-platforms"
        >
          Try again
        </Button>
      </div>
    );
  }

  const { platforms } = load.data;
  const selected = edited ?? initialSelection(platforms, status);

  function toggle(platform: SetupPlatform, checked: boolean) {
    if (platform.required) {
      return;
    }
    const next = new Set(selected);
    if (checked) {
      next.add(platform.marketplaceModuleId);
    } else {
      next.delete(platform.marketplaceModuleId);
    }
    setEdited(next);
  }

  async function handleContinue() {
    setSaveError(null);
    setSaving(true);
    try {
      await choosePlatforms({
        instanceId,
        platforms: platforms
          .filter((platform) => selected.has(platform.marketplaceModuleId))
          .map((platform) => ({
            marketplaceModuleId: platform.marketplaceModuleId,
            approvedPermissions: platform.permissions,
          })),
      });
      onContinue();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick the services woofx3 should work with. You can add more from the marketplace later.
      </p>

      <ul className="divide-y rounded-lg border" data-testid="list-setup-platforms">
        {platforms.map((platform) => {
          const checked = selected.has(platform.marketplaceModuleId);
          const checkboxId = `setup-platform-${platform.marketplaceModuleId}`;
          const permissions = describePermissions(platform.permissions);
          return (
            <li key={platform.marketplaceModuleId} className="flex gap-3 p-4">
              <Checkbox
                id={checkboxId}
                checked={checked}
                disabled={platform.required}
                onCheckedChange={(value) => toggle(platform, value === true)}
                className="mt-0.5"
                data-testid={`checkbox-${checkboxId}`}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <label htmlFor={checkboxId} className="flex items-center gap-2 font-medium cursor-pointer">
                  {platform.name}
                  <Badge variant={platform.required ? "default" : "secondary"} className="text-[10px]">
                    {platform.required ? "Required" : "Optional"}
                  </Badge>
                </label>
                <p className="text-sm text-muted-foreground">{platform.summary}</p>
                {permissions.length > 0 && (
                  <div className={cn("text-xs", checked ? "text-foreground" : "text-muted-foreground")}>
                    <p className="font-medium">{checked ? "You allow it to:" : "If chosen, it can:"}</p>
                    <ul className="list-disc pl-4">
                      {permissions.map((permission) => (
                        <li key={permission.id} className={cn(!permission.known && "text-amber-500")}>
                          {permission.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">Checking a platform approves what it lists.</p>

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <Button
        className="w-full"
        onClick={() => void handleContinue()}
        disabled={saving}
        data-testid="button-platforms-continue"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Continue
      </Button>
    </div>
  );
}
