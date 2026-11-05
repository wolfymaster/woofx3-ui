import { MonitorPlay } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RetryButton } from "@/components/setup/retry-button";
import type { EngineBuild } from "@/lib/engine-build";
import { LOADING_MESSAGES, nextLoadingMessage } from "@/lib/loading-messages";

const MESSAGE_INTERVAL_MS = 3_200;
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
  random?: () => number;
}

/**
 * The full-screen wait for someone who skipped or finished the overlay page
 * before their engine was built. Dressed as a stream's "starting soon" scene,
 * since that is the wait this audience already knows. Opens the dashboard by
 * itself; a failed build stops the show and says so.
 */
export function EngineSplash({ build, onReady, random = Math.random }: EngineSplashProps) {
  const failed = build.stage === "failed";
  const ready = build.stage === "ready";
  const [messageIndex, setMessageIndex] = useState(() => nextLoadingMessage(LOADING_MESSAGES.length, null, random));
  const failureHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (ready) {
      onReady();
    }
  }, [ready, onReady]);

  useEffect(() => {
    if (failed) {
      failureHeading.current?.focus();
      return;
    }
    const timer = setInterval(() => {
      setMessageIndex((previous) => nextLoadingMessage(LOADING_MESSAGES.length, previous, random));
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [failed, random]);

  return (
    <main
      className="fixed inset-0 flex flex-col overflow-hidden bg-neutral-950 text-neutral-50"
      data-testid="engine-splash"
    >
      <header className="flex items-center gap-2 p-6 text-sm text-neutral-400">
        <MonitorPlay className="h-4 w-4 text-primary" aria-hidden="true" />
        woofx3
      </header>

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
              Your dashboard is getting ready and opens by itself. You can close this tab and come back; it keeps going.
            </output>
          </>
        )}
      </div>

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
    </main>
  );
}
