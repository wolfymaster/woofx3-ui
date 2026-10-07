import { useEffect, useState } from "react";

/**
 * The current time, refreshed every minute. For views derived from a
 * timestamp, such as "online" from a last heartbeat: a Convex query does not
 * re-run as time passes, so the component keeps its own clock.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}
