import { useEffect, useState } from "react";
import { systemClock } from "@/lib/engine-session/system";
import { type LocalEngineSession, localEngineSession } from "./host";

/**
 * How often the host is asked how its engine is starting. The host has no
 * event for it, and asking is a local call, so a second's wait is the most a
 * ready engine waits to be noticed.
 */
const STARTUP_POLL_MS = 1000;

/** What a failed ask for the session reads as: the host is there but could not answer. */
function unanswered(error: unknown): LocalEngineSession {
  return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
}

/**
 * Where the local engine stands, asked of the host until it is ready, after
 * which it is no longer asked: the engine session reconnects by itself if the
 * engine restarts, under the same credentials.
 */
export function useLocalEngineSession(): LocalEngineSession | undefined {
  const [session, setSession] = useState<LocalEngineSession | undefined>(undefined);
  useEffect(() => {
    let stopped = false;
    let cancelNext: (() => void) | null = null;
    const ask = () => {
      localEngineSession()
        .then((answer) => answer, unanswered)
        .then((answer) => {
          if (stopped) {
            return;
          }
          setSession(answer);
          if (answer.kind !== "ready") {
            cancelNext = systemClock.schedule(STARTUP_POLL_MS, ask);
          }
        });
    };
    ask();
    return () => {
      stopped = true;
      cancelNext?.();
    };
  }, []);
  return session;
}
