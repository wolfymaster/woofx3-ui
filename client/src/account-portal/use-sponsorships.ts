import { api } from "@convex/_generated/api";
import type { Sponsorship } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";

export type SponsorshipList =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; sponsorships: Sponsorship[] };

/** The viewer's sponsorships, newest first; `reload` asks again and keeps showing the last answer meanwhile. */
export function useSponsorships(): { list: SponsorshipList; reload: () => void } {
  const mine = useAction(api.sponsorships.mine);
  const [list, setList] = useState<SponsorshipList>({ state: "loading" });
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((current) => current + 1), []);
  // `round` restarts the ask; the answer itself does not depend on it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: round is the reload trigger
  useEffect(() => {
    let current = true;
    mine({}).then(
      (sponsorships) => {
        if (current) {
          setList({ state: "ready", sponsorships });
        }
      },
      (error: unknown) => {
        if (current) {
          setList({ state: "failed", message: actionErrorMessage(error) });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [mine, round]);
  return { list, reload };
}
