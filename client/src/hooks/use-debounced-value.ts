import { useEffect, useMemo, useState } from "react";
import { createDebouncer } from "@/lib/debounce";

/**
 * Returns `value` once it has held still for `delayMs`. Keep the input bound
 * to the live value and feed the debounced one to whatever is expensive, such
 * as a query that round-trips to the engine.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  const debouncer = useMemo(() => createDebouncer<T>(delayMs, setSettled), [delayMs]);

  useEffect(() => {
    debouncer.push(value);
  }, [debouncer, value]);

  useEffect(() => {
    return () => debouncer.cancel();
  }, [debouncer]);

  return settled;
}
