import { useCallback, useEffect, useState } from "react";

/** A flag that clears itself `ms` after being raised, for "this should have shown up by now". */
export function useExpiringFlag(ms: number): [boolean, () => void] {
  const [raised, setRaised] = useState(false);
  useEffect(() => {
    if (!raised) {
      return;
    }
    const timer = setTimeout(() => setRaised(false), ms);
    return () => clearTimeout(timer);
  }, [raised, ms]);
  return [raised, useCallback(() => setRaised(true), [])];
}
