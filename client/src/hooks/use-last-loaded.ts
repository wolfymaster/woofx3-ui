import { useRef } from "react";

/**
 * A query result that keeps showing the last loaded value while new arguments
 * load, for a query whose arguments change on a timer (a `now` from
 * `useMinuteClock`): useQuery answers undefined for every new set of
 * arguments, which would flash a skeleton once a minute.
 *
 * The retained value belongs to `key` (such as the instance id), so switching
 * to another instance shows a loading state rather than the previous one's data.
 */
export function useLastLoaded<T>(value: T | undefined, key: string | undefined): T | undefined {
  const last = useRef<{ key: string | undefined; value: T } | null>(null);
  if (value !== undefined) {
    last.current = { key, value };
    return value;
  }
  if (last.current !== null && last.current.key === key) {
    return last.current.value;
  }
  return undefined;
}
