import { api } from "@convex/_generated/api";
import type { SponsorshipInterval } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useProviderRedirect } from "@/billing/provider-redirect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { amountProblem, dollarsText, parseDollars, prefillFromSearch } from "./amount";
import { AmountField } from "./amount-field";
import { INTERVAL_LABELS } from "./sponsorship-text";
import { useSponsorshipTerms } from "./use-sponsorship-terms";

const INTERVALS: readonly SponsorshipInterval[] = ["month", "once"];

/**
 * The confirm screen a sponsor lands on from the marketing site, signed in. The address only prefills the form; what
 * is charged is what the sponsor confirms here, checked against the plane's terms.
 */
export default function SponsorStart() {
  const search = useSearch();
  const [prefill] = useState(() => prefillFromSearch(search));
  const [amountText, setAmountText] = useState(dollarsText(prefill.amountCents));
  const [interval, setInterval] = useState<SponsorshipInterval>(prefill.interval);
  const terms = useSponsorshipTerms();
  const start = useAction(api.sponsorships.start);
  const { busy, go } = useProviderRedirect();

  const amountCents = parseDollars(amountText);
  const valid = terms.state === "ready" && amountCents !== null && amountProblem(amountCents, terms.terms) === null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md" data-testid="card-sponsor-start">
        <CardHeader>
          <CardTitle>Sponsor woofx3</CardTitle>
          <CardDescription>Thank you for supporting the project. Choose how you want to give.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <fieldset className="flex gap-2 border-0 p-0">
            <legend className="sr-only">How often</legend>
            {INTERVALS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={interval === option ? "default" : "outline"}
                aria-pressed={interval === option}
                onClick={() => setInterval(option)}
                data-testid={`button-interval-${option}`}
              >
                {INTERVAL_LABELS[option]}
              </Button>
            ))}
          </fieldset>
          {terms.state === "loading" ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          {terms.state === "failed" ? (
            <p className="text-sm text-destructive" data-testid="text-terms-failed">
              {terms.message}
            </p>
          ) : null}
          {terms.state === "ready" ? (
            <AmountField
              id="sponsor-amount"
              text={amountText}
              onTextChange={setAmountText}
              terms={terms.terms}
              testId="input-sponsor-amount"
            />
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              disabled={busy || !valid}
              onClick={() => {
                if (amountCents !== null) {
                  void go(() => start({ amountCents, interval }));
                }
              }}
              data-testid="button-continue-to-payment"
            >
              Continue to payment
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/account">Not now</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
