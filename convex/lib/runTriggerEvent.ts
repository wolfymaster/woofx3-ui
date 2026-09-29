/**
 * Whether a run's stored trigger event holds anything to replay.
 *
 * `{}` and `null` are what the db proxy stores when a run had no event, so
 * they count as absent -- a replay of either has nothing to re-feed.
 */
export function hasRecordedTriggerEvent(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const trimmed = raw.trim();
  return trimmed !== "" && trimmed !== "{}" && trimmed !== "null";
}
