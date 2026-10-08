import { useEffect, useState } from "react";

/**
 * A query result that keeps showing the last loaded value while new arguments
 * load, for a query whose arguments change on a timer: useQuery answers
 * undefined for every new set of arguments, which would flash a skeleton each
 * time they change.
 *
 * The retained value belongs to `key` (such as the instance id), so switching
 * to another instance shows a loading state rather than the previous one's data.
 */
export function useLastLoaded<T>(value: T | undefined, key: string | undefined): T | undefined {
  const [last, setLast] = useState<{ key: string | undefined; value: T } | null>(null);
  useEffect(() => {
    if (value !== undefined) {
      setLast({ key, value });
    }
  }, [key, value]);
  if (value !== undefined) {
    return value;
  }
  if (last !== null && last.key === key) {
    return last.value;
  }
  return undefined;
}
