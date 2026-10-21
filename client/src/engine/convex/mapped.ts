import { useMemo } from "react";
import type { Live } from "@/engine/types";

// Convex keeps a query's result object the same until the result changes, so
// mapping it under useMemo keeps the mapped value's identity just as stable,
// and effects that depend on it run no more often than they would on the row.
// `map` must be a module-level function for the memo to hold.

export function useMappedList<Row, Mapped>(rows: Live<Row[]>, map: (row: Row) => Mapped): Live<Mapped[]> {
  return useMemo(() => rows?.map(map), [rows, map]);
}

/** Maps a read that may also answer null, which passes through like `undefined`. */
export function useMappedValue<Row, Mapped>(value: Live<Row | null>, map: (row: Row) => Mapped): Live<Mapped | null> {
  return useMemo((): Live<Mapped | null> => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    return map(value);
  }, [value, map]);
}
