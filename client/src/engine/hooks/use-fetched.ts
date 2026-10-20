import { useCallback, useEffect, useRef, useState } from "react";
import type { Fetched } from "@/engine/types";
import { createRequestSequence } from "./request-sequence";

/**
 * A `Fetched` read of `request(args)`, asked again whenever `args` changes by
 * content and whenever `refetch` is called. `"skip"` clears the data and asks
 * nothing.
 *
 * `request` must keep its identity across renders (a gateway `use...Request`
 * function does); `args` need not, since it is compared as JSON. Its values
 * must therefore survive a JSON round trip.
 */
export function useFetched<Args, T>(request: (args: Args) => Promise<T>, args: Args | "skip"): Fetched<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const sequence = useRef(createRequestSequence());

  const argsKey = args === "skip" ? null : JSON.stringify(args);

  // biome-ignore lint/correctness/useExhaustiveDependencies: argsKey stands in for `args`, whose identity changes every render; reloadToken is the refetch trigger
  useEffect(() => {
    if (argsKey === null) {
      setData(undefined);
      return;
    }
    const ticket = sequence.current.next();
    setIsLoading(true);
    setError(null);

    void request(JSON.parse(argsKey) as Args)
      .then((result) => {
        if (sequence.current.isCurrent(ticket)) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (sequence.current.isCurrent(ticket)) {
          setError(err instanceof Error ? err.message : String(err));
          setData(undefined);
        }
      })
      .finally(() => {
        if (sequence.current.isCurrent(ticket)) {
          setIsLoading(false);
        }
      });
  }, [argsKey, reloadToken, request]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  return { data, isLoading, error, refetch };
}
