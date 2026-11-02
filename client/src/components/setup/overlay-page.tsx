import { DEFAULT_OVERLAY_CANVAS, defaultSceneInput } from "@shared/default-seed";
import { CircleCheck, Loader2, MonitorPlay } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link } from "wouter";
import { OverlayLink } from "@/components/setup/overlay-link";
import { OverlayStage } from "@/components/setup/overlay-stage";
import { RetryButton } from "@/components/setup/retry-button";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEngineAlerts, useOverlayOpen } from "@/engine/hooks/use-alert-queue";
import {
  useApplyDefaultSeedRequest,
  useDefaultSeedStatus,
  useMarkOverlayDoneRequest,
} from "@/engine/hooks/use-default-seed";
import { useBrowserSourceUrlRequest } from "@/engine/hooks/use-overlays";
import { useCreateSceneRequest, useScenes, useSceneWidgetCatalog } from "@/engine/hooks/use-scenes";
import { useWorkflows } from "@/engine/hooks/use-workflows";
import type { SceneId } from "@/engine/types";
import { useExpiringFlag } from "@/hooks/use-expiring-flag";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import type { EngineBuild } from "@/lib/engine-build";
import {
  followAlertOf,
  INITIAL_OVERLAY_STATE,
  type OverlayPhase,
  overlayReducer,
  overlaySceneOf,
  seedHasRecordedError,
  seedIsSlow,
  type TestOutcome,
  testFailureMessage,
  testOutcomeOf,
  waitingHelp,
} from "@/lib/overlay-onboarding";
import { ALERTS_PATH } from "@/lib/setup-steps";
import { initialValues, payloadFromValues, testEventFields } from "@/lib/test-event-fields";
import { cn } from "@/lib/utils";

const TICK_MS = 1_000;
const RECENT_ALERTS_LIMIT = 20;
const ALERT_SURFACE = "alert";
const SCENE_ARRIVAL_TIMEOUT_MS = 30_000;
const FLOW_STEPS = ["Add to your streaming app", "Send a test", "You're ready"];

/** Phases where the page has just put the streamer's next move in front of them. */
const FOCUS_ON: ReadonlySet<OverlayPhase["name"]> = new Set([
  "build-failed",
  "seed-failed",
  "no-scene",
  "waiting",
  "connected",
  "unconfirmed",
  "test-failed",
  "finished",
]);

function flowStepOf(phase: OverlayPhase): number {
  if (phase.name === "finished") {
    return 2;
  }
  return ["connected", "sending", "playing", "unconfirmed", "test-failed"].includes(phase.name) ? 1 : 0;
}

function moodOf(phase: OverlayPhase) {
  switch (phase.name) {
    case "connected":
    case "unconfirmed":
    case "test-failed":
      return "ready";
    case "sending":
    case "playing":
      return "playing";
    case "finished":
      return "celebrating";
    default:
      return "dark";
  }
}

function headingOf(phase: OverlayPhase, seedSlow: boolean): string {
  switch (phase.name) {
    case "building":
      return "Getting your overlay ready";
    case "preparing":
      return seedSlow ? "This is taking longer than usual" : "Getting your overlay ready";
    case "build-failed":
      return "We couldn't finish setting up";
    case "seed-failed":
      return "Your overlay didn't get set up";
    case "no-scene":
      return "You don't have an overlay right now";
    case "waiting":
      return "Add your overlay to your streaming app";
    case "connected":
      return "Overlay connected";
    case "sending":
    case "playing":
      return "Sending a test follow";
    case "unconfirmed":
      return "Did you see it?";
    case "test-failed":
      return "That alert didn't play";
    case "finished":
      return "Congratulations! Your alerts are working.";
  }
}

function statusOf(phase: OverlayPhase, engine: EngineBuild, seedSlow: boolean): string {
  switch (phase.name) {
    case "building":
      return engine.stage === "building" ? `${engine.message}. You can close this tab; it keeps going.` : "";
    case "preparing":
      return seedSlow
        ? "We keep trying by ourselves, or you can try again now."
        : "Adding your alerts for follows, subs and bits.";
    case "build-failed":
      return "This usually clears up with a retry.";
    case "seed-failed":
      return "Something stopped us adding it. Trying again usually sorts it out.";
    case "no-scene":
      return "It may have been deleted. Make a new one and you'll get a new link to add.";
    case "waiting":
      return phase.dropped
        ? "Your overlay disconnected. Waiting for it to come back."
        : "Waiting for your overlay to connect.";
    case "connected":
      return "Now let's see an alert play.";
    case "sending":
    case "playing":
      return "Watch your overlay, top right.";
    case "unconfirmed":
      return "We sent it but didn't hear back.";
    case "test-failed":
      return "Nothing played on your overlay.";
    case "finished":
      return "Your overlay will show follows, subs and bits as they happen. Real ones appear in Events too; tests don't.";
  }
}

function SetupInstructions() {
  const { width, height } = DEFAULT_OVERLAY_CANVAS;
  const sizeStep = `Set the width to ${width} and the height to ${height}, if it asks for a size.`;
  return (
    <Tabs defaultValue="obs">
      <TabsList>
        <TabsTrigger value="obs">OBS</TabsTrigger>
        <TabsTrigger value="streamlabs">Streamlabs</TabsTrigger>
        <TabsTrigger value="other">Something else</TabsTrigger>
      </TabsList>
      <TabsContent value="obs">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Under Sources, click + and choose Browser.</li>
          <li>Paste your link into the URL field.</li>
          <li>
            Set the width to {width} and the height to {height}, then click OK.
          </li>
        </ol>
      </TabsContent>
      <TabsContent value="streamlabs">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Add a new source to your scene, and pick the one that shows a web page.</li>
          <li>Paste your link where it asks for a URL.</li>
          <li>{sizeStep}</li>
        </ol>
      </TabsContent>
      <TabsContent value="other">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Most streaming apps can show a web page as a source. Add one to your scene.</li>
          <li>Paste your link where it asks for a URL.</li>
          <li>{sizeStep}</li>
        </ol>
      </TabsContent>
    </Tabs>
  );
}

function WaitingHelp({ help }: { help: "none" | "hint" | "troubleshoot" }) {
  if (help === "none") {
    return null;
  }
  if (help === "hint") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-overlay-hint">
        Nothing yet. Check that your streaming app is open and the new source is in the scene you&apos;re on.
      </p>
    );
  }
  return (
    <div className="space-y-1 text-sm text-muted-foreground" data-testid="list-overlay-troubleshooting">
      <p>Still waiting? Check that:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>the whole link was pasted, with nothing added</li>
        <li>your streaming app is open, and the source is in your current scene</li>
        <li>
          the source keeps running when it isn&apos;t visible (in OBS, turn off &quot;Shutdown source when not
          visible&quot;)
        </li>
      </ul>
    </div>
  );
}

/** The overlay's link, asked for once per scene. The engine answers the same link every time until it is rotated. */
function useOverlayUrl(sceneId: SceneId | undefined) {
  const request = useBrowserSourceUrlRequest();
  const [answer, setAnswer] = useState<{ sceneId: SceneId; url: string | null }>();
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what asks again.
  useEffect(() => {
    if (sceneId === undefined) {
      return;
    }
    let cancelled = false;
    request(sceneId).then(
      (url) => {
        if (!cancelled) {
          setAnswer({ sceneId, url });
        }
      },
      () => {
        if (!cancelled) {
          setAnswer({ sceneId, url: null });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [sceneId, request, attempt]);

  const current = answer?.sceneId === sceneId ? answer : undefined;
  const retry = useCallback(async () => {
    setAnswer(undefined);
    setAttempt((value) => value + 1);
  }, []);
  return { url: current?.url, failed: current?.url === null, retry };
}

interface OverlayPageProps {
  /** Comes from the delivery, since a lone local engine is never built and has no provisioning. */
  engine: EngineBuild;
  /** The streamer is done here, by finishing or by skipping; the outcome is already recorded. */
  onExit: () => void;
  clock?: () => number;
}

/**
 * The one first-run page: add the overlay to a streaming app, see it connect,
 * play a test alert. It works revisited long after setup as well. All of it
 * goes through the engine gateway, so local mode can use it as it is; whatever
 * is hosted-only arrives through `engine` and `onExit`.
 */
export function OverlayPage({ engine, onExit, clock = Date.now }: OverlayPageProps) {
  const engineReady = engine.stage === "ready";
  const seed = useDefaultSeedStatus();
  const scenes = useScenes({ enabled: engineReady });
  const catalog = useSceneWidgetCatalog({ enabled: engineReady });
  const workflows = useWorkflows();
  const alerts = useEngineAlerts(RECENT_ALERTS_LIMIT);
  const { triggerPresets } = useWorkflowCatalog();
  const fireTestEvent = useFireTestEvent();
  const applySeed = useApplyDefaultSeedRequest();
  const markDone = useMarkOverlayDoneRequest();
  const createScene = useCreateSceneRequest();

  const { fact: sceneFact, scene } = overlaySceneOf(seed, scenes, catalog);
  const { fact: followFact, event: followEvent } = followAlertOf(seed, workflows);
  const followPreset = triggerPresets.find((preset) => preset.event === followEvent);
  const { url, failed: urlFailed, retry: retryUrl } = useOverlayUrl(scene?.id);
  const presence = useOverlayOpen({ enabled: engineReady && sceneFact === "found" });
  const seedError = seedHasRecordedError(seed);

  const [state, dispatch] = useReducer(overlayReducer, INITIAL_OVERLAY_STATE);
  const [now, setNow] = useState(clock);
  const { phase, follow, triggerIds } = state;
  const outcome = testOutcomeOf(alerts ?? [], triggerIds);
  const outcomeKind = outcome.kind;
  const outcomeReason = outcome.kind === "failed" ? outcome.reason : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), TICK_MS);
    return () => clearInterval(timer);
  }, [clock]);

  useEffect(() => {
    const test: TestOutcome =
      outcomeKind === "failed" ? { kind: "failed", reason: outcomeReason } : { kind: outcomeKind };
    dispatch({
      type: "observe",
      at: now,
      facts: { engine: engine.stage, scene: sceneFact, follow: followFact, seedError, presence, test },
    });
  }, [engine.stage, sceneFact, followFact, seedError, presence, outcomeKind, outcomeReason, now]);

  const heading = useRef<HTMLHeadingElement>(null);
  const previousPhase = useRef<OverlayPhase["name"] | null>(null);
  useEffect(() => {
    if (previousPhase.current !== null && previousPhase.current !== phase.name && FOCUS_ON.has(phase.name)) {
      heading.current?.focus();
    }
    previousPhase.current = phase.name;
  }, [phase.name]);

  // Finishing is recorded as it happens, so leaving by closing the tab counts.
  // A failure here is safe to drop: Open Dashboard records it again and reports.
  useEffect(() => {
    if (phase.name === "finished") {
      markDone("finished").catch(() => undefined);
    }
  }, [phase.name, markDone]);

  async function sendTest() {
    if (!followPreset) {
      return;
    }
    dispatch({ type: "send" });
    const fields = testEventFields(followPreset);
    const triggerId = await fireTestEvent(followPreset, payloadFromValues(fields, initialValues(fields)));
    dispatch(triggerId === null ? { type: "send-refused" } : { type: "sent", triggerId, at: clock() });
  }

  async function retrySeed() {
    await applySeed();
    dispatch({ type: "seed-retried" });
  }

  async function leave() {
    await markDone(phase.name === "finished" ? "finished" : "skipped");
    onExit();
  }

  // The new scene reaches the reads a moment after the engine makes it; the
  // button stays away until then so a second press makes no second scene, and
  // comes back if the scene never arrives.
  const [sceneRequested, markSceneRequested] = useExpiringFlag(SCENE_ARRIVAL_TIMEOUT_MS);
  const alertWidget = catalog?.find((row) => row.hostsSurface === ALERT_SURFACE);
  const otherAlertFailed = seed?.alerts.some((alert) => alert.status === "failed" && alert.itemId !== "follow");
  const alreadyDone = Boolean(seed?.overlayDone);
  const flowStep = flowStepOf(phase);
  const seedSlow = seedIsSlow(state, now);

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="order-2 flex items-center bg-neutral-900 p-4 sm:p-8 lg:min-h-screen">
        <OverlayStage mood={moodOf(phase)} />
      </div>

      <div className="order-1 flex flex-col gap-6 p-6 sm:p-10">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MonitorPlay className="h-4 w-4 text-primary" aria-hidden="true" />
          Your overlay
        </div>

        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Progress">
          {FLOW_STEPS.map((title, index) => (
            <li
              key={title}
              aria-current={index === flowStep ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5",
                index === flowStep ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {index < flowStep || phase.name === "finished" ? (
                <CircleCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{index + 1}</span>
              )}
              {title}
            </li>
          ))}
        </ol>

        <div className="space-y-2">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-balance text-3xl font-bold tracking-tight outline-none"
            data-testid="text-overlay-heading"
          >
            {headingOf(phase, seedSlow)}
          </h1>
          <output className="flex items-center gap-2 text-muted-foreground" data-testid="text-overlay-status">
            {(phase.name === "waiting" || (phase.name === "preparing" && !seedSlow)) && (
              <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            )}
            {statusOf(phase, engine, seedSlow)}
          </output>
        </div>

        {phase.name === "building" && engine.stage === "building" && (
          <Progress value={engine.percent} className="h-1.5" aria-label="Setting up" />
        )}

        {phase.name === "build-failed" && engine.stage === "failed" && (
          <RetryButton onRetry={engine.retry} testId="button-overlay-build-retry" />
        )}

        {phase.name === "seed-failed" && <RetryButton onRetry={retrySeed} testId="button-overlay-seed-retry" />}

        {phase.name === "preparing" && seedSlow && (
          <RetryButton onRetry={retrySeed} testId="button-overlay-seed-slow-retry" />
        )}

        {phase.name === "no-scene" &&
          (sceneRequested ? (
            <p className="text-sm text-muted-foreground">Making your overlay…</p>
          ) : alertWidget ? (
            <RetryButton
              label="Make a new overlay"
              testId="button-overlay-new-scene"
              onRetry={async () => {
                await createScene(defaultSceneInput({ canonicalId: alertWidget.widgetId, name: alertWidget.name }));
                markSceneRequested();
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              We can&apos;t make one until your alert widget is available. Try again in a moment.
            </p>
          ))}

        {phase.name === "waiting" && (
          <>
            {url ? (
              <OverlayLink url={url} />
            ) : urlFailed ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">We couldn&apos;t get your link.</p>
                <RetryButton onRetry={retryUrl} testId="button-overlay-url-retry" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Getting your link…</p>
            )}
            <SetupInstructions />
            <WaitingHelp help={waitingHelp(phase.since, now)} />
            {url && (
              <p className="text-sm text-muted-foreground">
                Don&apos;t have a streaming app open?{" "}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  data-testid="link-overlay-new-tab"
                >
                  Try it in a new tab
                </a>
              </p>
            )}
          </>
        )}

        {phase.name === "connected" && (
          <>
            {follow === "ready" && (
              <Button
                size="lg"
                className="self-start"
                disabled={!followPreset}
                onClick={() => void sendTest()}
                data-testid="button-overlay-send-test"
              >
                {!followPreset && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />}
                Send a test alert
              </Button>
            )}
            {follow === "pending" && (
              <p className="text-sm text-muted-foreground">Your follow alert is nearly ready to test.</p>
            )}
            {follow === "failed" && (
              <div className="space-y-2">
                <p className="text-sm">Your follow alert didn&apos;t get set up.</p>
                <RetryButton onRetry={retrySeed} testId="button-overlay-follow-retry" />
              </div>
            )}
            {follow === "missing" && (
              <p className="text-sm" data-testid="text-overlay-no-follow">
                There&apos;s no follow alert to test.{" "}
                <Link href={ALERTS_PATH} className="font-medium text-primary underline-offset-4 hover:underline">
                  Open your alerts
                </Link>{" "}
                to make one.
              </p>
            )}
            {url && <OverlayLink url={url} />}
          </>
        )}

        {phase.name === "unconfirmed" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => dispatch({ type: "confirmed-seen" })} data-testid="button-overlay-saw-it">
              Yes, it played
            </Button>
            <Button variant="outline" onClick={() => void sendTest()} data-testid="button-overlay-send-again">
              Send again
            </Button>
          </div>
        )}

        {phase.name === "test-failed" && (
          <>
            <p className="text-sm" data-testid="text-overlay-test-failure">
              {testFailureMessage(phase.reason)}
            </p>
            <Button className="self-start" onClick={() => void sendTest()} data-testid="button-overlay-test-retry">
              Try again
            </Button>
          </>
        )}

        {otherAlertFailed && phase.name !== "seed-failed" && (
          <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="text-overlay-alerts-failed">
            <p>Some of your other alerts didn&apos;t get set up.</p>
            <RetryButton variant="outline" onRetry={retrySeed} testId="button-overlay-alerts-retry" />
          </div>
        )}

        {seedSlow && phase.name !== "preparing" && phase.name !== "seed-failed" && (
          <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="text-overlay-alerts-slow">
            <p>Adding your alerts is taking longer than usual.</p>
            <RetryButton variant="outline" onRetry={retrySeed} testId="button-overlay-alerts-slow-retry" />
          </div>
        )}

        <div className="mt-auto pt-4">
          {phase.name === "finished" ? (
            <RetryButton label="Open Dashboard" onRetry={leave} testId="button-overlay-open-dashboard" />
          ) : (
            <RetryButton
              variant="outline"
              label={alreadyDone ? "Back to dashboard" : "Skip for now"}
              onRetry={leave}
              testId="button-overlay-skip"
            />
          )}
        </div>
      </div>
    </main>
  );
}
