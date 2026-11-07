import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type ResolvedSetupPlatforms, TWITCH_SETUP_MODULE_ID } from "@convex/lib/setupPlatforms";
import type { SetupStatus } from "@convex/setup";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ManagedEngineStep } from "@/components/onboarding/managed-engine-step";
import { ChoosePlan, TrialNote } from "@/components/onboarding/plan-prompt";
import { TwitchConnectCard, type TwitchPermissionsLoad } from "@/components/setup/twitch-connect-card";
import { AskAdminToConnectTwitch, AskOwnerToChooseUsername } from "@/components/setup/twitch-step";
import { Button } from "@/components/ui/button";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";
import { IS_DESKTOP } from "@/lib/desktop";
import { useLogger } from "@/lib/logger-context";
import { setupStepPath } from "@/lib/setup-steps";

interface ConnectStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; data: ResolvedSetupPlatforms };

function chosenFrom(load: Load) {
  const platform =
    load.state === "ready"
      ? load.data.platforms.find((candidate) => candidate.marketplaceModuleId === TWITCH_SETUP_MODULE_ID)
      : undefined;
  return platform ?? null;
}

function permissionsLoad(load: Load): TwitchPermissionsLoad {
  if (load.state === "loading") {
    return load;
  }
  const twitch = chosenFrom(load);
  return twitch === null ? { state: "failed" } : { state: "ready", permissions: twitch.permissions };
}

/**
 * Setup's first page. Connecting Twitch is separate from signing in with it: it
 * grants the scopes the engine uses on the channel, and only an owner or admin
 * may grant them. Connecting is also the consent to what the card lists: once
 * Twitch approves, the permissions shown are saved as what the module's install
 * later accepts, and a build asking for more is brought back for approval. A
 * reconnect only restores the link.
 *
 * Coming back from Twitch finishes setup on the server (`setup.finishFirstRun`)
 * and setup's routing moves on from here by itself. A preview deployment can
 * also skip, so a password account gets through.
 *
 * On a hosted engine the org's owner is told the engine is built on the free
 * trial, or, once the trial is used up and the subscription isn't usable, asked
 * to choose a plan before anything is built (`access.planPrompt`).
 */
export function ConnectStep({ instanceId, status }: ConnectStepProps) {
  const logger = useLogger();
  const listForSetup = useAction(api.setupPlatformsActions.listForSetup);
  const prepareConnect = useMutation(api.setup.prepareConnect);
  const skipTwitch = useMutation(api.setup.skipTwitch);
  const complete = useMutation(api.setup.complete);
  const { connect, starting, error: connectError } = useTwitchConnect();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // The desktop app never shows billing, a trial or the portal.
  const planPrompt = useQuery(api.access.planPrompt, IS_DESKTOP ? "skip" : { instanceId });

  const fetchPlatforms = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      setLoad({ state: "ready", data: await listForSetup({ instanceId }) });
    } catch (err) {
      logger.error("Could not list platforms", { error: err });
      setLoad({ state: "error" });
    }
  }, [listForSetup, instanceId, logger]);

  useEffect(() => {
    void fetchPlatforms();
  }, [fetchPlatforms]);

  if (!status.canManageSetup) {
    return <AskAdminToConnectTwitch />;
  }

  if (planPrompt?.kind === "choosePlan") {
    return <ChoosePlan />;
  }

  if (status.usernameNeeded) {
    return status.ownsAccount ? <ManagedEngineStep instanceId={instanceId} /> : <AskOwnerToChooseUsername />;
  }

  const twitch = chosenFrom(load);
  const consent = twitch
    ? [
        {
          marketplaceModuleId: twitch.marketplaceModuleId,
          name: twitch.name,
          approvedPermissions: twitch.permissions,
          approvedLocalEndpoints: twitch.localEndpoints.map((endpoint) => endpoint.id),
        },
      ]
    : [];

  async function run(action: () => Promise<unknown>) {
    setSaveFailed(false);
    setSaving(true);
    try {
      await action();
    } catch (err) {
      logger.error("Could not save", { error: err });
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const failure = saveFailed ? "That didn't work. Try again in a moment." : connectError;
  const busy = saving || starting;

  // Linked some other way before setup finished, such as from the integrations page.
  if (status.twitchUsername !== null) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm" data-testid="text-twitch-connected">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          Connected as <span className="font-medium">@{status.twitchUsername}</span>
        </p>
        {failure && <p className="text-sm text-destructive">{failure}</p>}
        <Button
          className="w-full"
          disabled={busy || twitch === null}
          onClick={() => void run(() => complete({ instanceId, platforms: consent }))}
          data-testid="button-twitch-continue"
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {planPrompt?.kind === "trial" && !status.engineRegistered && <TrialNote endsAt={planPrompt.endsAt} />}
      <TwitchConnectCard
        load={permissionsLoad(load)}
        onRetry={() => void fetchPlatforms()}
        failure={failure}
        busy={busy}
        onConnect={() =>
          void run(async () => {
            await prepareConnect({ instanceId, platforms: consent });
            await connect(setupStepPath("connect"));
          })
        }
      />

      {status.canSkipTwitch && (
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => void run(() => skipTwitch({ instanceId, platforms: consent }))}
          data-testid="button-twitch-skip"
        >
          Skip for now
        </Button>
      )}

      {!status.engineRegistered && (
        <Link
          href="/auth/onboarding?external=1"
          className="block text-center text-xs text-muted-foreground hover:text-foreground"
          data-testid="link-connect-own-engine"
        >
          Running your own server? Connect it
        </Link>
      )}
    </div>
  );
}
