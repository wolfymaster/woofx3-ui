import { useStore } from "@nanostores/react";
import { $nowPerSecond } from "@/lib/now";
import { formatUptime } from "@/lib/utils";

/**
 * Elapsed time since `startedAt`, re-rendering once a second. Render it only
 * while the stream is live: mounting it is what starts the shared ticker.
 */
export function Uptime({ startedAt, className }: { startedAt: string; className?: string }) {
  const now = useStore($nowPerSecond);
  return <span className={className}>{formatUptime(startedAt, now)}</span>;
}
