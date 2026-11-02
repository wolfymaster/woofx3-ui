import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type ResolvedSetupPlatforms, TWITCH_SETUP_MODULE_ID } from "@convex/lib/setupPlatforms";
import type { SetupStatus } from "@convex/setup";
import { useAction, useMutation } from "convex/react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ManagedEngineStep } from "@/components/onboarding/managed-engine-step";
import { AskAdminToConnectTwitch } from "@/components/setup/twitch-step";
import { TwitchGlyph } from "@/components/twitch/twitch-glyph";
import { Button } from "@/components/ui/button";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";
import { describePermissions } from "@/lib/module-permissions";
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
 */
export function ConnectStep({ instanceId, status }: ConnectStepProps) {
  const listForSetup = useAction(api.setupPlatformsActions.listForSetup);
  const prepareConnect = useMutation(api.setup.prepareConnect);
  const skipTwitch = useMutation(api.setup.skipTwitch);
  const complete = useMutation(api.setup.complete);
  const { connect, starting, error: connectError } = useTwitchConnect();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const fetchPlatforms = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      setLoad({ state: "ready", data: await listForSetup({ instanceId }) });
    } catch (err) {
      console.error("[connect-step] could not list platforms", String(err));
      setLoad({ state: "error" });
    }
  }, [listForSetup, instanceId]);

  useEffect(() => {
    void fetchPlatforms();
  }, [fetchPlatforms]);

  if (!status.canManageSetup) {
    return <AskAdminToConnectTwitch />;
  }

  if (status.usernameNeeded) {
    return <ManagedEngineStep instanceId={instanceId} />;
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
      console.error("[connect-step] could not save", String(err));
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
      <p className="text-sm text-muted-foreground">This is where your alerts come from.</p>

      <div className="rounded-lg border p-4 space-y-3" data-testid="card-connect-twitch">
        <div className="flex items-center gap-2 font-medium">
          <TwitchGlyph className="h-5 w-5" />
          Twitch
        </div>

        {load.state === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Getting things ready…
          </p>
        )}

        {(load.state === "error" || (load.state === "ready" && twitch === null)) && (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              We can't reach Twitch setup right now.
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
        )}

        {twitch && (
          <div className="text-sm">
            <p className="font-medium">What woofx3 can do on your channel:</p>
            <ul className="list-disc pl-5 text-muted-foreground" data-testid="list-twitch-permissions">
              <li>Read your chat and stream events, so alerts can play</li>
              {describePermissions(twitch.permissions).map((permission) => (
                <li key={permission.id} className={permission.known ? undefined : "text-amber-500"}>
                  {permission.description}
                </li>
              ))}
            </ul>
          </div>
        )}

        {failure && <p className="text-sm text-destructive">{failure}</p>}

        <Button
          className="w-full"
          disabled={busy || twitch === null}
          onClick={() =>
            void run(async () => {
              await prepareConnect({ instanceId, platforms: consent });
              await connect(setupStepPath("connect"));
            })
          }
          data-testid="button-connect-twitch"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Connect Twitch
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">More platforms are on the way.</p>
      <p className="text-xs text-muted-foreground">Connecting means you approve what's listed.</p>

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
