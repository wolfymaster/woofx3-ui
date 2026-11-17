import { api } from "@convex/_generated/api";
import type { PlanPrice } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

export interface PlanPrices {
  /** Null until the plane's answer (or its absence) is known, and while it is unavailable. */
  prices: PlanPrice[] | null;
  names: Record<string, string>;
}

const NOT_LOADED: PlanPrices = { prices: null, names: {} };

/** The plane's list prices and the plan names, asked once when the plan page appears. */
export function usePlanPrices(): PlanPrices {
  const fetchPrices = useAction(api.prices.list);
  const [answer, setAnswer] = useState<PlanPrices>(NOT_LOADED);
  useEffect(() => {
    let current = true;
    fetchPrices({}).then(
      (listing) => {
        if (current) {
          setAnswer({ prices: listing.state === "ready" ? listing.prices : null, names: listing.names });
        }
      },
      () => {
        if (current) {
          setAnswer(NOT_LOADED);
        }
      }
    );
    return () => {
      current = false;
    };
  }, [fetchPrices]);
  return answer;
}
