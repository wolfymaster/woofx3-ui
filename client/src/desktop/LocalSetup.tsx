import { DEFAULT_DASHBOARD_LAYOUT_ID } from "@shared/default-seed";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { TwitchApprovalCode } from "@/components/settings/twitch-approval-code";
import { OverlayPage } from "@/components/setup/overlay-page";
import { SetupShell } from "@/components/setup/setup-shell";
import { TwitchConnectCard, type TwitchPermissionsLoad } from "@/components/setup/twitch-connect-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAddDashboardPanelRequest,
  useDashboardPanels,
  useSetDashboardPanelWidgetsRequest,
} from "@/engine/hooks/use-dashboard";
import { useApplyDefaultSeedRequest, useDefaultSeedStatus } from "@/engine/hooks/use-default-seed";
import { useLiveConnection } from "@/engine/hooks/use-live-connection";
import { useInstalledModules, useMarketplaceInstallRequest, useModuleDetailRequest } from "@/engine/hooks/use-modules";
import { useTwitchLink } from "@/engine/hooks/use-twitch-link";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";
import { localDashboardCatalog } from "@/lib/dashboard-widgets/local-catalog";
import { useLogger } from "@/lib/logger-context";
import { SETUP_STEPS, setupStepPath } from "@/lib/setup-steps";
import {
  localDefaultDashboardWidgets,
  localSetupStep,
  SEED_APPLY_DELAYS_MS,
  seedHasPending,
  TWITCH_MODULE_ID,
  twitchModuleInstalled,
} from "./local-setup";

const LOCAL_WIDGET_TYPES: ReadonlySet<string> = new Set(localDashboardCatalog.widgets.map((widget) => widget.type));

interface Consent {
  permissions: string[];
  localEndpoints: string[];
}

/**
 * What finishing the connect page does in hosted setup on the server: install
 * the Twitch module with the permissions the page listed, and give the
 * streamer a first dashboard panel unless they have one. The default seed
 * follows from the setup page once the module is in.
 */
function useFinishConnect() {
  const install = useMarketplaceInstallRequest();
  const panels = useDashboardPanels();
  const addPanel = useAddDashboardPanelRequest();
  const setPanelWidgets = useSetDashboardPanelWidgetsRequest();
  const modules = useInstalledModules();

  return useCallback(
    async (consent: Consent) => {
      if (modules === undefined || panels === undefined) {
        throw new Error("Still loading; try again in a moment.");
      }
      if (!twitchModuleInstalled(modules)) {
        await install(TWITCH_MODULE_ID, consent.permissions, consent.localEndpoints);
      }
      if (panels.length === 0) {
        const panelId = await addPanel(DEFAULT_DASHBOARD_LAYOUT_ID, "Main");
        await setPanelWidgets(panelId, localDefaultDashboardWidgets(LOCAL_WIDGET_TYPES));
      }
    },
    [install, modules, panels, addPanel, setPanelWidgets]
  );
}

/**
 * Applies the default seed while setup runs, as hosted setup's apply does on
 * the server: once connecting is done, and again after each delay while
 * anything is still pending. The seed's own record keeps a scene or alert the
 * streamer deleted from coming back, so a repeated apply is safe.
 */
function useSeedWhileConnected(connected: boolean) {
  const logger = useLogger();
  const seed = useDefaultSeedStatus();
  const apply = useApplyDefaultSeedRequest();
  const [attempt, setAttempt] = useState(0);
  const pending = seed !== undefined && seed !== null && seedHasPending(seed);

  useEffect(() => {
    if (!connected || !pending || attempt >= SEED_APPLY_DELAYS_MS.length) {
      return;
    }
    const timer = setTimeout(() => {
      apply()
        .catch((error: unknown) => logger.warn("Could not apply the default seed", { error }))
        .finally(() => setAttempt((previous) => previous + 1));
    }, SEED_APPLY_DELAYS_MS[attempt]);
    return () => clearTimeout(timer);
  }, [connected, pending, attempt, apply, logger]);
}

function LocalConnectStep({ onConnected }: { onConnected: () => void }) {
  const logger = useLogger();
  const detail = useModuleDetailRequest();
  const finish = useFinishConnect();
  const link = useTwitchLink();
  const { connect, cancel, starting, error: connectError, linking } = useTwitchConnect();
  const [load, setLoad] = useState<TwitchPermissionsLoad>({ state: "loading" });
  const [localEndpoints, setLocalEndpoints] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const connecting = useRef(false);

  const fetchPermissions = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const twitch = await detail(TWITCH_MODULE_ID);
      if (twitch.permissions === null) {
        setLoad({ state: "failed" });
        return;
      }
      setLocalEndpoints((twitch.localEndpoints ?? []).map((endpoint) => endpoint.id));
      setLoad({ state: "ready", permissions: twitch.permissions });
    } catch (error) {
      logger.error("Could not read the Twitch module's permissions", { error });
      setLoad({ state: "failed" });
    }
  }, [detail, logger]);

  useEffect(() => {
    void fetchPermissions();
  }, [fetchPermissions]);

  const consent = useMemo(
    (): Consent | null => (load.state === "ready" ? { permissions: load.permissions, localEndpoints } : null),
    [load, localEndpoints]
  );

  const run = useCallback(async () => {
    if (consent === null) {
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      await finish(consent);
      onConnected();
    } catch (error) {
      logger.error("Could not finish connecting", { error });
      setSaveError(error instanceof Error ? error.message : "That didn't work. Try again in a moment.");
    } finally {
      setSaving(false);
    }
  }, [consent, finish, onConnected, logger]);

  // Approving the code on Twitch moves on with no click, as returning from Twitch does in hosted setup.
  useEffect(() => {
    if (connecting.current && link) {
      connecting.current = false;
      void run();
    }
  }, [link, run]);

  const busy = saving || starting;
  const failure = saveError ?? connectError;

  if (link) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm" data-testid="text-twitch-connected">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          Connected as <span className="font-medium">@{link.platformUsername}</span>
        </p>
        {failure && <p className="text-sm text-destructive">{failure}</p>}
        <Button
          className="w-full"
          disabled={busy || consent === null}
          onClick={() => void run()}
          data-testid="button-twitch-continue"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TwitchConnectCard
        load={load}
        onRetry={() => void fetchPermissions()}
        failure={failure}
        busy={busy}
        onConnect={() => {
          connecting.current = true;
          void connect(setupStepPath("connect"));
        }}
      >
        <TwitchApprovalCode
          linking={linking}
          onCancel={() => {
            connecting.current = false;
            cancel();
          }}
        />
      </TwitchConnectCard>

      {/* No account to keep Twitch for, so connecting can wait; the module still installs so alerts can be tested. */}
      <Button
        variant="ghost"
        className="w-full"
        disabled={busy || consent === null}
        onClick={() => void run()}
        data-testid="button-twitch-skip"
      >
        Skip for now
      </Button>
    </div>
  );
}

/**
 * Local mode's first run, the same pages as hosted setup: connect Twitch, then
 * the overlay page, then the dashboard. There is no engine build to wait for
 * and no account to set up, so connecting is done once the Twitch module is
 * installed. Rendered outside the app shell, so it keeps the live connection
 * the overlay page's reads follow.
 */
export default function LocalSetup() {
  useLiveConnection();
  const params = useParams<{ step?: string }>();
  const [, navigate] = useLocation();
  const modules = useInstalledModules();
  const [justConnected, setJustConnected] = useState(false);
  const connected = modules !== undefined && twitchModuleInstalled(modules);
  useSeedWhileConnected(connected || justConnected);

  const step = modules === undefined ? null : localSetupStep(connected, justConnected);

  useEffect(() => {
    if (step !== null && params.step !== step) {
      navigate(setupStepPath(step), { replace: true });
    }
  }, [step, params.step, navigate]);

  const onConnected = useCallback(() => setJustConnected(true), []);

  if (step === "overlay") {
    return <OverlayPage engine={{ stage: "ready" }} onExit={() => navigate("/")} />;
  }

  return (
    <SetupShell activeStep={step}>
      {step === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-setup-step-title">{SETUP_STEPS[0].title}</CardTitle>
          </CardHeader>
          <CardContent>
            <LocalConnectStep onConnected={onConnected} />
          </CardContent>
        </Card>
      )}
    </SetupShell>
  );
}
