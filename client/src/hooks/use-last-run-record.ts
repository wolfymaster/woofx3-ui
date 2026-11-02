import { useRef } from "react";

/**
 * `record`, or the last one seen under `key` once it is gone.
 *
 * A run's transient rows expire a minute after they are written, so a row
 * disappearing says nothing about the run. Only a key that never had a row can
 * read as nothing having happened.
 */
export function useLastRunRecord<Row>(key: string | null, record: Row | null | undefined): Row | null | undefined {
  const lastSeen = useRef<{ key: string; record: Row } | null>(null);
  if (key !== null && record !== null && record !== undefined) {
    lastSeen.current = { key, record };
  }
  return record ?? (lastSeen.current?.key === key ? lastSeen.current.record : record);
}
