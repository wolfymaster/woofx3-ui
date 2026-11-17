import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { MyOrganization } from "@convex/organizations";
import { useAction, useMutation } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatPrice, planName } from "@/billing/format";
import { PLAN_DETAILS, TRIAL_DAYS } from "@/billing/plan-details";
import { useProviderRedirect } from "@/billing/provider-redirect";
import { usePlanPrices } from "@/billing/use-plan-prices";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { CHECKOUT_POLL_TEXT } from "@/lib/checkout-return";
import { useCheckoutPoll } from "@/lib/use-checkout-poll";
import { cn } from "@/lib/utils";

const INTERVALS: Array<{ interval: BillingInterval; label: string; note?: string }> = [
  { interval: "month", label: "Monthly" },
  { interval: "year", label: "Yearly", note: "2 months free" },
];

interface OnboardingPlansProps {
  /** Starts the Starter trial and the engine build; nothing is made until it is called. */
  onStartTrial: () => void;
}

/**
 * The first question of onboarding: which plan. Starter begins its free trial
 * with no card; Pro goes to checkout first and comes back to engine setup once
 * paid. An organization is only made when one of the two buttons is pressed.
 */
export function OnboardingPlans({ onStartTrial }: OnboardingPlansProps) {
  const ensureMyAccount = useMutation(api.accounts.ensureMyAccount);
  const startCheckout = useAction(api.billingCommands.startCheckout);
  const { prices, names } = usePlanPrices();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const { busy, go } = useProviderRedirect();

  function buyPro() {
    return go(async () => {
      try {
        const accountId = await ensureMyAccount({});
        return await startCheckout({ accountId, plan: "pro", interval });
      } catch (error) {
        toast({ title: "Could not start checkout", description: actionErrorMessage(error), variant: "destructive" });
        return null;
      }
    });
  }

  return (
    <div className="space-y-6" data-testid="screen-onboarding-plans">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your plan</h1>
        <p className="text-sm text-muted-foreground">
          Your engine runs your alerts, overlays and chat commands. Pick the plan to run it on.
        </p>
      </div>
      <fieldset className="flex items-center justify-center gap-1 rounded-lg bg-muted p-1 w-fit mx-auto">
        <legend className="sr-only">Billing period for Pro</legend>
        {INTERVALS.map(({ interval: option, label, note }) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={interval === option ? "secondary" : "ghost"}
            aria-pressed={interval === option}
            onClick={() => setInterval(option)}
            data-testid={`toggle-interval-${option}`}
          >
            {label}
            {note ? <span className="ml-1.5 text-xs text-muted-foreground">{note}</span> : null}
          </Button>
        ))}
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <PlanCard
          plan="starter"
          title={planName(names, "starter")}
          price={formatPrice(prices, "starter", interval)}
          highlight={`${TRIAL_DAYS}-day free trial, no card needed`}
        >
          <Button className="w-full" onClick={onStartTrial} data-testid="button-start-starter-trial">
            Start your {TRIAL_DAYS}-day free trial
          </Button>
          <p className="text-xs text-center text-muted-foreground">Add payment any time.</p>
        </PlanCard>
        <PlanCard
          plan="pro"
          title={planName(names, "pro")}
          price={formatPrice(prices, "pro", interval)}
          highlight="Billed up front, no trial"
          emphasised
        >
          <Button className="w-full" disabled={busy} onClick={buyPro} data-testid="button-buy-pro">
            Buy now
          </Button>
        </PlanCard>
      </div>
    </div>
  );
}

interface PlanCardProps {
  plan: PlanTier;
  title: string;
  price: string;
  highlight: string;
  emphasised?: boolean;
  children: React.ReactNode;
}

function PlanCard({ plan, title, price, highlight, emphasised = false, children }: PlanCardProps) {
  const details = PLAN_DETAILS[plan];
  return (
    <Card
      className={cn("flex flex-col", emphasised && "border-primary ring-1 ring-primary")}
      data-testid={`card-plan-${plan}`}
    >
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between">
          <span>{title}</span>
          <span className="text-lg font-normal">{price}</span>
        </CardTitle>
        <CardDescription>{details.tagline}</CardDescription>
        <p className="text-sm font-medium text-primary">{highlight}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <ul className="space-y-2 text-sm">
          {details.highlights.map((item) => (
            <li key={item} className="flex gap-2">
              <Check className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2">{children}</div>
      </CardContent>
    </Card>
  );
}

interface PaymentConfirmingProps {
  accountId: Id<"accounts">;
  checkoutId: string;
  /** Whether the organization's own billing already shows the paid subscription. */
  reflected: boolean;
  onConfirmed: () => void;
  onGiveUp: () => void;
}

/** Waits for the payment provider's word on a checkout, then hands on to the engine build. */
export function PaymentConfirming({ accountId, checkoutId, reflected, onConfirmed, onGiveUp }: PaymentConfirmingProps) {
  const checkoutState = useAction(api.billingCommands.checkoutState);
  const ask = useCallback(
    async (id: string) => (await checkoutState({ accountId, checkoutId: id })).state,
    [checkoutState, accountId]
  );
  const poll = useCheckoutPoll(ask, checkoutId, reflected);
  const phase = poll?.phase ?? "polling";
  useEffect(() => {
    if (phase === "complete") {
      onConfirmed();
    }
  }, [phase, onConfirmed]);

  if (phase === "polling" || phase === "complete") {
    return (
      <output className="flex flex-col items-center gap-3 py-6" data-testid="screen-confirming-payment">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Confirming your payment…</span>
      </output>
    );
  }
  return (
    <div className="space-y-4 text-center" data-testid="screen-payment-not-confirmed">
      <p className="text-sm text-muted-foreground">{CHECKOUT_POLL_TEXT[phase]}</p>
      <Button variant="outline" onClick={onGiveUp}>
        Back to plans
      </Button>
    </div>
  );
}

interface WebPlanStepProps {
  /** Set when the customer just came back from paying; that checkout is confirmed before the engine is built. */
  confirmingCheckoutId: string | null;
  /** Undefined while loading. */
  organizations: MyOrganization[] | undefined;
  onStartTrial: () => void;
  onPaid: () => void;
  onGiveUp: () => void;
  hasPreviewEngine: boolean;
  onUsePreviewEngine: () => void;
}

/** What the web shows in place of the desktop's "how do you run your engine" question. */
export function WebPlanStep({
  confirmingCheckoutId,
  organizations,
  onStartTrial,
  onPaid,
  onGiveUp,
  hasPreviewEngine,
  onUsePreviewEngine,
}: WebPlanStepProps) {
  if (confirmingCheckoutId !== null) {
    const organization = organizations?.find((org) => org.can.manageBilling);
    if (organization === undefined) {
      return <PaymentConfirmingSpinner />;
    }
    return (
      <PaymentConfirming
        accountId={organization.accountId}
        checkoutId={confirmingCheckoutId}
        reflected={organization.subscription?.hasProviderSubscription ?? false}
        onConfirmed={onPaid}
        onGiveUp={onGiveUp}
      />
    );
  }
  return (
    <div className="space-y-4">
      <OnboardingPlans onStartTrial={onStartTrial} />
      {hasPreviewEngine ? (
        <Button
          className="w-full"
          variant="outline"
          onClick={onUsePreviewEngine}
          data-testid="button-connect-preview-engine"
        >
          Connect this preview&apos;s engine
        </Button>
      ) : null}
    </div>
  );
}

function PaymentConfirmingSpinner() {
  return (
    <output className="flex justify-center py-6" aria-label="Confirming your payment">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </output>
  );
}
