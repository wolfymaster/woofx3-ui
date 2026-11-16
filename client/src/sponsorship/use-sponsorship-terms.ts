import { api } from "@convex/_generated/api";
import type { SponsorshipTerms } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";

export type TermsState =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; terms: SponsorshipTerms };

/** The plane's limits on a sponsorship amount, asked once when the form appears. */
export function useSponsorshipTerms(): TermsState {
  const fetchTerms = useAction(api.sponsorships.terms);
  const [terms, setTerms] = useState<TermsState>({ state: "loading" });
  useEffect(() => {
    let current = true;
    fetchTerms({}).then(
      (answer) => {
        if (current) {
          setTerms({ state: "ready", terms: answer });
        }
      },
      (error: unknown) => {
        if (current) {
          setTerms({ state: "failed", message: actionErrorMessage(error) });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [fetchTerms]);
  return terms;
}
