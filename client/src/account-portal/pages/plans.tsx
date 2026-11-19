import { api } from "@convex/_generated/api";
import type { AppliedDiscount } from "@convex/lib/billingClient";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { OrgSubscription } from "@convex/organizations";
import { useAction } from "convex/react";
import { Check } from "lucide-react";
import { useCallback, useState } from "react";
import { useSearch } from "wouter";
import { BillingSummary, type BillingSummaryItem } from "@/billing/billing-summary";
import { describeDiscount, formatPrice, planName } from "@/billing/format";
import { PLAN_DETAILS } from "@/billing/plan-details";
import { ProviderRedirectButton, useProviderRedirect } from "@/billing/provider-redirect";
import { StatusBanner } from "@/billing/status-banner";
import { type PlanPrices, usePlanPrices } from "@/billing/use-plan-prices";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { CHECKOUT_CANCELLED_TEXT, CHECKOUT_POLL_TEXT, parseCheckoutReturn } from "@/lib/checkout-return";
import { useCheckoutPoll } from "@/lib/use-checkout-poll";
import { cn } from "@/lib/utils";
import { type BillingView, billingView, checkoutRefusalAction } from "../billing-view";
import { useOrganization } from "../organization-context";
import { planLabel, stateLabel, subscriptionNotice } from "../subscription-text";

const PLAN_TIERS: PlanTier[] = ["starter", "pro"];
const INTERVALS: Array<{ interval: BillingInterval; label: string; note?: string }> = [
  { interval: "month", label: "Monthly" },
  { interval: "year", label: "Yearly", note: "2 months free" },
];

/** "Starter, monthly - $60/mo" while a provider subscription sets the interval; the plan name alone otherwise. */
function planSummary(subscription: OrgSubscription, { prices, names }: PlanPrices): string {
  if (subscription.plan === null || subscription.interval === null) {
    return planLabel(subscription, names);
  }
  return `${planLabel(subscription, names)} - ${formatPrice(prices, subscription.plan, subscription.interval)}`;
}

/** Every plan is listed, so the one an organization is on can be compared with the rest; none when it can't buy. */
function offeredPlans(view: BillingView): PlanTier[] {
  switch (view.kind) {
    case "choose_plan":
    case "no_plan":
    case "provider_managed":
      return PLAN_TIERS;
    case "exempt":
    case "no_subscription_needed":
      return [];
  }
}

/** The plan an organization pays for through the provider; null before it has bought one. */
function currentPlan(view: BillingView): PlanTier | null {
  return view.kind === "provider_managed" ? view.subscription.plan : null;
}

function UpgradeOptions({ prices, names, view }: PlanPrices & { view: BillingView }) {
  const { organization } = useOrganization();
  const startCheckout = useAction(api.billingCommands.startCheckout);
  const openPortal = useAction(api.billingCommands.openPortal);
  const previewPromotionCode = useAction(api.billingCommands.previewPromotionCode);
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ code: string; discount: AppliedDiscount | null } | null>(null);
  const { busy, go } = useProviderRedirect();
  const plans = offeredPlans(view);
  const changesExisting = view.kind === "provider_managed";
  const current = currentPlan(view);

  if (plans.length === 0) {
    return null;
  }

  async function applyCode() {
    try {
      const discount = await previewPromotionCode({ accountId: organization.accountId, code });
      setPreview({ code: code.trim(), discount });
    } catch (error) {
      toast({ title: "Could not check the code", description: actionErrorMessage(error), variant: "destructive" });
    }
  }

  const promotionCode = preview?.discount ? preview.code : undefined;

  function choose(plan: PlanTier) {
    return go(async () => {
      if (changesExisting) {
        return openPortal({ accountId: organization.accountId });
      }
      try {
        return await startCheckout({ accountId: organization.accountId, plan, interval, promotionCode });
      } catch (error) {
        const action = checkoutRefusalAction(error);
        if (action === "open_portal") {
          toast({ title: "Update your payment method", description: actionErrorMessage(error) });
          return openPortal({ accountId: organization.accountId });
        }
        if (action === "contact_support") {
          toast({ title: "Organization suspended", description: actionErrorMessage(error), variant: "destructive" });
          return null;
        }
        throw error;
      }
    });
  }

  return (
    <section className="space-y-6" data-testid="section-upgrade-options">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold">{changesExisting ? "All plans" : "Choose a plan"}</h2>
        <p className="text-sm text-muted-foreground">
          {changesExisting ? "Compare plans and change yours any time." : "Pick the plan to run your engine on."}
        </p>
      </div>
      <fieldset className="mx-auto flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        <legend className="sr-only">Billing period</legend>
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
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((plan) => {
          const details = PLAN_DETAILS[plan];
          return (
            <Card
              key={plan}
              className={cn("flex flex-col", plan === current && "border-primary ring-1 ring-primary")}
              data-testid={`card-plan-${plan}`}
            >
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between">
                  <span className="flex items-center gap-2">
                    {planName(names, plan)}
                    {plan === current ? <Badge data-testid={`badge-current-${plan}`}>Current plan</Badge> : null}
                  </span>
                  <span className="text-lg font-normal">{formatPrice(prices, plan, interval)}</span>
                </CardTitle>
                <CardDescription>{details.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <PlanHighlights items={details.highlights} />
                <Button
                  disabled={busy || plan === current}
                  variant={plan === current ? "outline" : "default"}
                  onClick={() => choose(plan)}
                  data-testid={`button-choose-${plan}`}
                >
                  {plan === current
                    ? "Your plan"
                    : changesExisting
                      ? `Change to ${planName(names, plan)}`
                      : `Choose ${planName(names, plan)}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {changesExisting ? null : (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto px-0 text-sm font-normal underline underline-offset-2">
              Have a promotion code?
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div className="flex max-w-sm gap-2">
              <Input
                aria-label="Promotion code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setPreview(null);
                }}
                data-testid="input-promotion-code"
              />
              <Button variant="outline" onClick={applyCode} disabled={code.trim() === ""}>
                Apply
              </Button>
            </div>
            {preview ? (
              <p className="text-sm text-muted-foreground" data-testid="text-promotion-preview">
                {preview.discount ? describeDiscount(preview.discount) : "That code isn't valid."}
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

function PlanHighlights({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** What the organization is on now: its plan, where that stands, and what it includes. */
function ActivePlan({
  view,
  planPrices,
  checkoutNotice,
}: {
  view: BillingView;
  planPrices: PlanPrices;
  checkoutNotice: React.ReactNode;
}) {
  const { organization } = useOrganization();
  const openPortal = useAction(api.billingCommands.openPortal);
  const subscription =
    view.kind === "exempt" || view.kind === "provider_managed" || view.kind === "choose_plan"
      ? view.subscription
      : null;
  const notice = subscription === null ? null : subscriptionNotice(subscription);
  const discount = organization.subscription?.discount ?? null;
  const plan = subscription?.plan ?? null;

  const items: BillingSummaryItem[] = [];
  if (subscription !== null) {
    items.push({ label: "Current plan", value: planSummary(subscription, planPrices), testId: "text-billing-plan" });
    items.push({ label: "State", value: stateLabel(subscription), testId: "text-billing-state" });
  }
  if (discount !== null) {
    items.push({ label: "Discount", value: discount.label, testId: "text-active-discount" });
  }

  return (
    <Card data-testid="card-active-plan">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-2xl">
          {plan === null ? "Your plan" : `You're on the ${planName(planPrices.names, plan)} plan`}
        </CardTitle>
        {plan !== null ? <CardDescription>{PLAN_DETAILS[plan].tagline}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {checkoutNotice}
        {view.kind === "no_subscription_needed" ? (
          <p className="text-center" data-testid="text-no-subscription-needed">
            No subscription needed for self-hosted engines.
          </p>
        ) : null}
        {view.kind === "no_plan" ? <p className="text-center">Your hosted engine has no plan yet.</p> : null}
        {items.length > 0 ? <BillingSummary items={items} /> : null}
        {notice ? <StatusBanner tone="warning">{notice}</StatusBanner> : null}
        {plan !== null ? <PlanHighlights items={PLAN_DETAILS[plan].highlights} /> : null}
        {view.kind === "provider_managed" ? (
          <div className="flex justify-center">
            <ProviderRedirectButton
              label="Manage billing"
              testId="button-manage-billing"
              open={() => openPortal({ accountId: organization.accountId })}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The organization's plan and the ones it can move to. Checkout comes back here. */
export default function PlansPage() {
  const { organization } = useOrganization();
  const checkoutState = useAction(api.billingCommands.checkoutState);
  const { accountId } = organization;
  const planPrices = usePlanPrices();
  const askCheckoutState = useCallback(
    async (checkoutId: string) => (await checkoutState({ accountId, checkoutId })).state,
    [checkoutState, accountId]
  );
  const checkoutReturn = parseCheckoutReturn(useSearch());
  const view = billingView(organization);
  const poll = useCheckoutPoll(
    askCheckoutState,
    checkoutReturn.kind === "done" ? checkoutReturn.checkoutId : null,
    view.kind === "provider_managed"
  );

  const checkoutNotice =
    checkoutReturn.kind === "cancelled" ? (
      <p className="text-center text-sm text-muted-foreground" data-testid="text-checkout-cancelled">
        {CHECKOUT_CANCELLED_TEXT}
      </p>
    ) : checkoutReturn.kind === "done" && view.kind !== "no_subscription_needed" ? (
      <p className="text-center text-sm text-muted-foreground" data-testid="text-checkout-done">
        {poll === null
          ? "Thanks! Your payment is being confirmed, and your plan updates here in a moment."
          : CHECKOUT_POLL_TEXT[poll.phase]}
      </p>
    ) : null;

  return (
    <>
      <PageHeader title="Plans" description="The plan behind this organization's hosted engines." />
      <div className="space-y-10">
        <ActivePlan view={view} planPrices={planPrices} checkoutNotice={checkoutNotice} />
        <UpgradeOptions {...planPrices} view={view} />
      </div>
    </>
  );
}
