import { MonitorPlay } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DuckHop } from "@/components/setup/duck-hop";
import { EngineBuildProgress } from "@/components/setup/engine-build-progress";
import { RetryButton } from "@/components/setup/retry-button";
import { WaitRoomStatusBar } from "@/components/setup/wait-room-status-bar";
import { Button } from "@/components/ui/button";
import type { EngineBuild } from "@/lib/engine-build";
import { LOADING_MESSAGES, nextLoadingMessage } from "@/lib/loading-messages";

const MESSAGE_INTERVAL_MS = 3_200;
/** How long the ready card waits before opening the dashboard by itself. */
export const READY_AUTO_OPEN_MS = 8_000;
/** The level meter's bars, each on its own beat. Heights are fixed so the row never reads as data. */
const METER_BARS = Array.from({ length: 48 }, (_, index) => ({
  key: index,
  delayMs: (index * 137) % 1100,
  height: 30 + ((index * 53) % 70),
}));

interface EngineSplashProps {
  build: EngineBuild;
  /** Called once the engine is ready. */
  onReady: () => void;
  /** Returns to the overlay page, where the streamer can test their alert. */
  onBackToOverlay: () => void;
  /** Overridable so tests need not sit through the real delay. */
  autoOpenMs?: number;
  random?: () => number;
}

/**
 * The full-screen wait for someone who skipped or finished the overlay page
 * before their engine was built. Dressed as a stream's "starting soon" scene,
 * since that is the wait this audience already knows. A build that finishes
 * while this is on screen gets a ready card with an auto-open, so someone who
 * walked away still lands on their dashboard; a failed build stops the show and
 * says so.
 */
export function EngineSplash({
  build,
  onReady,
  onBackToOverlay,
  autoOpenMs = READY_AUTO_OPEN_MS,
  random = Math.random,
}: EngineSplashProps) {
  const failed = build.stage === "failed";
  const ready = build.stage === "ready";
  const [messageIndex, setMessageIndex] = useState(() => nextLoadingMessage(LOADING_MESSAGES.length, null, random));
  const failureHeading = useRef<HTMLHeadingElement>(null);
  const readyHeading = useRef<HTMLHeadingElement>(null);
  const [showReady, setShowReady] = useState(false);
  const [staying, setStaying] = useState(false);

  // A build already finished when this opened has nothing left to wait for, so
  // it opens at once as it always has. One that finishes while this is on
  // screen earns the ready card, which can be cancelled.
  const arrivedReady = useRef(ready);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (arrivedReady.current) {
      onReady();
      return;
    }
    setShowReady(true);
  }, [ready, onReady]);

  useEffect(() => {
    if (!showReady || staying) {
      return;
    }
    const timer = setTimeout(onReady, autoOpenMs);
    return () => clearTimeout(timer);
  }, [showReady, staying, autoOpenMs, onReady]);

  useEffect(() => {
    if (failed) {
      failureHeading.current?.focus();
      return;
    }
    if (ready || showReady) {
      return;
    }
    const timer = setInterval(() => {
      setMessageIndex((previous) => nextLoadingMessage(LOADING_MESSAGES.length, previous, random));
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [failed, ready, showReady, random]);

  useEffect(() => {
    if (showReady) {
      readyHeading.current?.focus();
    }
  }, [showReady]);

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden bg-neutral-950 text-neutral-50"
      data-testid="engine-splash"
    >
      <header className="flex items-center justify-between gap-4 p-6 text-sm text-neutral-400">
        <span className="flex items-center gap-2">
          <MonitorPlay className="h-4 w-4 text-primary" aria-hidden="true" />
          woofx3
        </span>
        {build.stage === "building" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50"
            onClick={onBackToOverlay}
            data-testid="button-splash-back"
          >
            Back to your overlay
          </Button>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col justify-center gap-6 px-6 sm:px-12 lg:px-24">
          {failed ? (
            <>
              <h1
                ref={failureHeading}
                tabIndex={-1}
                className="text-3xl font-bold tracking-tight outline-none sm:text-5xl"
              >
                We couldn&apos;t finish setting up
              </h1>
              <output className="block max-w-prose text-neutral-300" data-testid="text-splash-failed">
                This usually clears up with a retry.
              </output>
              <div>
                <RetryButton onRetry={build.retry} testId="button-splash-retry" />
              </div>
            </>
          ) : showReady ? (
            <>
              <p className="text-lg font-medium text-primary">You&apos;re all set</p>
              <h1
                ref={readyHeading}
                tabIndex={-1}
                className="text-balance text-4xl font-bold leading-tight tracking-tight outline-none sm:text-6xl"
                data-testid="text-splash-ready"
              >
                Your dashboard is ready
              </h1>
              <output className="block max-w-prose text-neutral-400">
                {staying
                  ? "Staying here. Open your dashboard when you're ready."
                  : "Opening your dashboard in a few seconds."}
              </output>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={onReady} data-testid="button-splash-open-dashboard">
                  Open dashboard
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800 hover:text-neutral-50"
                  onClick={onBackToOverlay}
                  data-testid="button-splash-test-alert"
                >
                  Test your alert first
                </Button>
                {!staying && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
                    onClick={() => setStaying(true)}
                    data-testid="button-splash-stay"
                  >
                    Stay here
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-primary">Starting soon</p>
              <p
                key={messageIndex}
                aria-hidden="true"
                className="min-h-[2.5em] max-w-4xl text-balance text-4xl font-bold leading-tight tracking-tight motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 sm:text-6xl"
                data-testid="text-splash-message"
              >
                {LOADING_MESSAGES[messageIndex]}
              </p>
              <output className="block max-w-prose text-neutral-400">
                Your dashboard is getting ready and opens by itself. You can close this tab and come back; it keeps
                going.
              </output>
              {build.stage === "building" && (
                <EngineBuildProgress build={build} tone="dark" variant="compact" className="max-w-xl" />
              )}
            </>
          )}
        </div>
      </main>

      <DuckHop enabled={build.stage === "building"}>
        <div className="flex h-24 items-end gap-1 px-6 pb-6 sm:h-32" aria-hidden="true">
          {METER_BARS.map((bar) => (
            <span
              key={bar.key}
              className={
                failed
                  ? "h-1 flex-1 rounded-sm bg-neutral-700"
                  : "flex-1 origin-bottom rounded-sm bg-primary/70 motion-safe:animate-level-meter"
              }
              style={failed ? undefined : { height: `${bar.height}%`, animationDelay: `${bar.delayMs}ms` }}
            />
          ))}
        </div>
      </DuckHop>

      {build.stage === "building" && <WaitRoomStatusBar build={build} />}
    </div>
  );
}
