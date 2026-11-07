import { CreditCard, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const BILLING_PATH = "/org/billing";

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Shown while a hosted engine is built on the org's free trial. */
export function TrialNote({ endsAt }: { endsAt: number }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-trial-note">
      <Sparkles className="h-4 w-4 shrink-0" />
      30-day Starter trial, no card needed. It ends {day(endsAt)}.
    </p>
  );
}

/**
 * Takes the connect screen's place when the org's trial is used up and its
 * subscription isn't active. Billing opens in a new tab; this screen moves on
 * by itself once the plan is active, since the prompt is a live query.
 */
export function ChoosePlan() {
  return (
    <div className="space-y-4" data-testid="screen-choose-plan">
      <div className="rounded-md border p-4 flex gap-3">
        <CreditCard className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Choose a plan to build your engine</p>
          <p className="text-muted-foreground">
            Your organization's free trial has been used. Pick a plan, and this page carries on once it's active.
          </p>
        </div>
      </div>
      <Button asChild className="w-full" data-testid="button-choose-plan">
        <a href={BILLING_PATH} target="_blank" rel="noreferrer">
          Choose a plan
        </a>
      </Button>
      <Link
        href="/auth/onboarding?external=1"
        className="block text-center text-xs text-muted-foreground hover:text-foreground"
        data-testid="link-connect-own-engine"
      >
        Running your own server? Connect it
      </Link>
    </div>
  );
}
