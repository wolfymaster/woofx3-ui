import { api } from "@convex/_generated/api";
import { PLACEHOLDER_NAME } from "@convex/lib/firstRun";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Loader2, MonitorPlay, Server } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { parseCheckoutReturn } from "@/lib/checkout-return";
import { IS_DESKTOP } from "@/lib/desktop";
import { useLogger } from "@/lib/logger-context";
import {
  ACCOUNT_PATH,
  enginesForOnboarding,
  NEW_ENGINE_PARAM,
  type OnboardingRoute,
  onboardingRoute,
} from "@/lib/onboarding-route";
import { $currentInstanceId } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { WebPlanStep } from "./onboarding-plans";

/**
 * Where a user sets up an engine, on the way to setup. The page asks one
 * question, how to run the engine, and makes nothing until it is answered: an
 * organization, an engine and a trial only ever follow a press, so someone who
 * only looks around (or only came to sponsor) is left a plain user. The form
 * is for an engine the user runs themselves, reached from the question, from a
 * link on the connect screen, or the only option on a deployment with no
 * managed engines.
 *
 * All state lives in Convex, so coming back here mid-build goes straight on to
 * wherever setup is.
 */
export default function Onboarding() {
  const logger = useLogger();
  const [, navigate] = useLocation();
  const search = useSearch();
  const { isAuthenticated } = useConvexAuth();
  const now = useMinuteClock();

  const ensureFirstRun = useMutation(api.setup.ensureFirstRun);
  const ensureMyAccount = useMutation(api.accounts.ensureMyAccount);
  const createInstance = useMutation(api.instances.create);
  const registerInstance = useAction(api.registration.registerInstance);
  const managedEngines = useQuery(api.provisioning.isAvailable);
  const previewEngine = useQuery(api.previewEngine.get);
  const memberInstances = useQuery(api.instances.listForCurrentUser);
  const organizations = useQuery(api.organizations.mine, { now });
  const checkoutReturn = parseCheckoutReturn(search);
  const confirmingCheckoutId = checkoutReturn.kind === "done" ? checkoutReturn.checkoutId : null;
  const wantsNewEngine = new URLSearchParams(search).has(NEW_ENGINE_PARAM);
  const instances = useMemo(
    () => memberInstances && enginesForOnboarding(memberInstances, wantsNewEngine),
    [memberInstances, wantsNewEngine]
  );

  const [instanceUrl, setInstanceUrl] = useState("localhost:8080");
  const [connecting, setConnecting] = useState(false);
  const [pairingFailed, setPairingFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choseManaged, setChoseManaged] = useState(false);
  const [chosePairedEngine, setChosePairedEngine] = useState(false);
  const started = useRef<OnboardingRoute | null>(null);

  const route =
    !isAuthenticated || instances === undefined || managedEngines === undefined || previewEngine === undefined
      ? null
      : onboardingRoute({
          instances,
          wantsOwnEngine: IS_DESKTOP && new URLSearchParams(search).has("external"),
          choseManaged,
          chosePairedEngine,
          hasPreviewEngine: previewEngine !== null,
          managedAvailable: managedEngines.available,
        });

  async function connectEngine(url: string): Promise<boolean> {
    setError(null);
    setConnecting(true);
    try {
      const accountId = await ensureMyAccount({});
      const instanceId = await createInstance({ accountId, name: PLACEHOLDER_NAME, url: url.trim() });
      const result = await registerInstance({ instanceId });
      if (!result.ok) {
        setError(`We couldn't connect to that server: ${result.error}`);
        return false;
      }
      $currentInstanceId.set(instanceId);
      navigate("/setup", { replace: true });
      return true;
    } catch (err) {
      logger.error("Could not connect the engine", { error: err });
      setError("We couldn't connect to that server. Check the address and try again.");
      return false;
    } finally {
      setConnecting(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: each route starts once, guarded by `started`.
  useEffect(() => {
    if (route === "setup" && instances) {
      const current =
        instances.find((instance) => instance.clientId) ??
        instances.find((instance) => instance.hosting === "managed") ??
        instances[0];
      $currentInstanceId.set(current._id);
      navigate("/setup", { replace: true });
      return;
    }
    if (started.current === route || route === null || route === "own-engine-form" || route === "choose") {
      return;
    }
    started.current = route;
    if (route === "paired-engine" && previewEngine) {
      setInstanceUrl(previewEngine.url);
      void connectEngine(previewEngine.url).then((connected) => setPairingFailed(!connected));
      return;
    }
    ensureFirstRun({})
      .then((instanceId) => {
        $currentInstanceId.set(instanceId);
        navigate("/setup/connect", { replace: true });
      })
      .catch((err: unknown) => {
        logger.error("Could not prepare setup", { error: err });
        setError("Something went wrong getting you set up. Reload the page to try again.");
      });
  }, [route, instances, previewEngine, ensureFirstRun, navigate, logger]);

  // On the web the plan comes first; an organization that already has one (a trial or a payment) goes on to the engine.
  const hasPlan = organizations?.some((org) => org.subscription !== null) ?? false;
  useEffect(() => {
    if (!IS_DESKTOP && route === "choose" && hasPlan && confirmingCheckoutId === null) {
      setChoseManaged(true);
    }
  }, [route, hasPlan, confirmingCheckoutId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await connectEngine(instanceUrl);
  }

  function chooseOwnEngine() {
    const params = new URLSearchParams(search);
    params.set("external", "1");
    navigate(`/auth/onboarding?${params}`);
  }

  if (!isAuthenticated) {
    return null;
  }

  const wide = route === "choose" && !IS_DESKTOP;
  const showForm = route === "own-engine-form" || (route === "paired-engine" && pairingFailed);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className={cn("w-full", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <span className="font-bold text-2xl tracking-tight">woofx3</span>
        </div>

        {route === "choose" && !error && !IS_DESKTOP && (
          <WebPlanStep
            confirmingCheckoutId={confirmingCheckoutId}
            organizations={organizations}
            onStartTrial={() => setChoseManaged(true)}
            onPaid={() => setChoseManaged(true)}
            onGiveUp={() => navigate("/auth/onboarding", { replace: true })}
            hasPreviewEngine={previewEngine !== null && previewEngine !== undefined}
            onUsePreviewEngine={() => setChosePairedEngine(true)}
          />
        )}

        {route === "choose" && !error && IS_DESKTOP && (
          <Card>
            <CardHeader>
              <CardTitle>Set up your streaming engine</CardTitle>
              <CardDescription>
                Your engine runs your alerts, overlays and chat commands. How would you like to run it?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {managedEngines?.available && (
                <Button
                  className="w-full"
                  onClick={() => setChoseManaged(true)}
                  data-testid="button-choose-managed-engine"
                >
                  Let woofx3 run it for you
                </Button>
              )}
              {previewEngine && (
                <Button
                  className="w-full"
                  variant={managedEngines?.available ? "outline" : "default"}
                  onClick={() => setChosePairedEngine(true)}
                  data-testid="button-connect-preview-engine"
                >
                  Connect this preview&apos;s engine
                </Button>
              )}
              <Button
                className="w-full"
                variant="outline"
                onClick={chooseOwnEngine}
                data-testid="button-choose-own-engine"
              >
                I run my own engine
              </Button>
            </CardContent>
          </Card>
        )}

        {!showForm && route !== "choose" && !error && (
          <output className="flex justify-center py-6" aria-label="Getting you set up">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </output>
        )}

        {!showForm && error && <p className="text-sm text-destructive text-center">{error}</p>}

        {showForm && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Connect your server</CardTitle>
                  <CardDescription>Point woofx3 at the engine you run yourself</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="instance-url">Server address</Label>
                  <Input
                    id="instance-url"
                    value={instanceUrl}
                    onChange={(event) => setInstanceUrl(event.target.value)}
                    placeholder="localhost:8080"
                    className="mt-1 font-mono"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {previewEngine
                      ? `This preview is paired with engine ${previewEngine.version ?? previewEngine.url}.`
                      : "The address where your server is running. Include the port if it needs one."}
                  </p>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" className="w-full" disabled={connecting} data-testid="button-connect-engine">
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {connecting ? "Connecting…" : "Connect"}
                </Button>

                {managedEngines?.available && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setChoseManaged(true);
                    }}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-create-managed-engine"
                  >
                    Don&apos;t have one? Let woofx3 run it for you
                  </button>
                )}
              </form>
            </CardContent>
          </Card>
        )}

        {!IS_DESKTOP && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Not setting up an engine today?{" "}
            <Link href={ACCOUNT_PATH} className="underline" data-testid="link-go-to-account">
              Go to my account
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
