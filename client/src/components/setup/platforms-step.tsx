import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ResolvedSetupPlatforms, SetupPlatform } from "@convex/lib/setupPlatforms";
import type { SetupStatus } from "@convex/setup";
import { useAction, useMutation } from "convex/react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SetupPlatformCard } from "@/components/setup/setup-platform-card";
import { Button } from "@/components/ui/button";

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
  // Null until the user toggles a card; until then the selection follows the saved choice or the defaults.
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
            name: platform.name,
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="list-setup-platforms">
        {platforms.map((platform) => (
          <SetupPlatformCard
            key={platform.marketplaceModuleId}
            platform={platform}
            selected={selected.has(platform.marketplaceModuleId)}
            onToggle={(checked) => toggle(platform, checked)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">Choosing a platform approves what it lists.</p>

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
