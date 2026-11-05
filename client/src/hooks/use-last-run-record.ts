import { useRef } from "react";

function isSettled(record: { status: string }): boolean {
  return record.status !== "progress";
}

/**
 * `record`, or the last one seen under `key` once it is gone.
 *
 * A run's transient rows expire a minute after they are written, so a row
 * disappearing says nothing about the run. Only a key that never had a row can
 * read as nothing having happened. A settled record is kept over a later
 * progress one: the engine can write a run's `progress` row just after its
 * terminal row, and the two expire in that order too.
 */
export function useLastRunRecord<Row extends { status: string }>(
  key: string | null,
  record: Row | null | undefined
): Row | null | undefined {
  const lastSeen = useRef<{ key: string; record: Row } | null>(null);
  const kept = lastSeen.current?.key === key ? lastSeen.current.record : null;
  if (
    key !== null &&
    record !== null &&
    record !== undefined &&
    (kept === null || !isSettled(kept) || isSettled(record))
  ) {
    lastSeen.current = { key, record };
  }
  return lastSeen.current?.key === key ? lastSeen.current.record : record;
}
