import { api } from "@convex/_generated/api";
import type { AppliedDiscount } from "@convex/lib/billingClient";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { OrgSubscription } from "@convex/organizations";
import { useAction, useMutation } from "convex/react";
import { Check } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useSearch } from "wouter";
import { BillingSummary, type BillingSummaryItem } from "@/billing/billing-summary";
import { describeDiscount, formatPrice, PLAN_NAMES } from "@/billing/format";
import { PLAN_DETAILS } from "@/billing/plan-details";
import { ProviderRedirectButton, useProviderRedirect } from "@/billing/provider-redirect";
import { StatusBanner } from "@/billing/status-banner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { CHECKOUT_CANCELLED_TEXT, CHECKOUT_POLL_TEXT, parseCheckoutReturn } from "@/lib/checkout-return";
import { useCheckoutPoll } from "@/lib/use-checkout-poll";
import { cn } from "@/lib/utils";
import { billingView, checkoutRefusalAction } from "../billing-view";
import { useOptionalOrganization, useOrganization } from "../organization-context";
import { RenameDialog } from "../rename-dialog";
import { SponsorshipSection } from "../sponsorship-section";
import { planLabel, stateLabel, subscriptionNotice } from "../subscription-text";

const PLAN_TIERS: PlanTier[] = ["starter", "pro"];
const INTERVALS: Array<{ interval: BillingInterval; label: string; note?: string }> = [
  { interval: "month", label: "Monthly" },
  { interval: "year", label: "Yearly", note: "2 months free" },
];

/** "Starter, monthly - $60/mo" while a provider subscription sets the interval; the plan name alone otherwise. */
function planSummary(subscription: OrgSubscription): string {
  if (subscription.plan === null || subscription.interval === null) {
    return planLabel(subscription);
  }
  return `${planLabel(subscription)} - ${formatPrice(subscription.plan, subscription.interval)}`;
}

function PlanChooser() {
  const { organization } = useOrganization();
  const startCheckout = useAction(api.billingCommands.startCheckout);
  const openPortal = useAction(api.billingCommands.openPortal);
  const previewPromotionCode = useAction(api.billingCommands.previewPromotionCode);
  const [tier, setTier] = useState<PlanTier>("starter");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ code: string; discount: AppliedDiscount | null } | null>(null);
  const { busy, go } = useProviderRedirect();

  async function applyCode() {
    try {
      const discount = await previewPromotionCode({ accountId: organization.accountId, code });
      setPreview({ code: code.trim(), discount });
    } catch (error) {
      toast({ title: "Could not check the code", description: actionErrorMessage(error), variant: "destructive" });
    }
  }

  const promotionCode = preview?.discount ? preview.code : undefined;

  return (
    <div className="space-y-6">
      <fieldset className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
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
      <RadioGroup
        value={tier}
        onValueChange={(value) => setTier(value as PlanTier)}
        className="grid gap-4 lg:grid-cols-2"
      >
        {PLAN_TIERS.map((plan) => {
          const details = PLAN_DETAILS[plan];
          return (
            <Label
              key={plan}
              htmlFor={`plan-${plan}`}
              className={cn(
                "flex flex-col gap-4 rounded-lg border p-5 cursor-pointer font-normal",
                tier === plan && "border-primary ring-1 ring-primary"
              )}
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem id={`plan-${plan}`} value={plan} className="mt-1" data-testid={`radio-plan-${plan}`} />
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold">{PLAN_NAMES[plan]}</span>
                    <span className="text-lg">{formatPrice(plan, interval)}</span>
                  </div>
                  <p className="text-sm font-medium">{details.tagline}</p>
                  <p className="text-sm text-muted-foreground">{details.audience}</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm">
                {details.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2">
                    <Check className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </Label>
          );
        })}
      </RadioGroup>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto px-0 text-sm font-normal underline underline-offset-2">
            Have a promotion code?
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div className="flex gap-2 max-w-sm">
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
      <Button
        disabled={busy}
        onClick={() =>
          go(async () => {
            try {
              return await startCheckout({
                accountId: organization.accountId,
                plan: tier,
                interval,
                promotionCode,
              });
            } catch (error) {
              const action = checkoutRefusalAction(error);
              if (action === "open_portal") {
                toast({ title: "Update your payment method", description: actionErrorMessage(error) });
                return openPortal({ accountId: organization.accountId });
              }
              if (action === "contact_support") {
                toast({
                  title: "Organization suspended",
                  description: actionErrorMessage(error),
                  variant: "destructive",
                });
                return null;
              }
              throw error;
            }
          })
        }
        data-testid="button-continue-to-checkout"
      >
        Continue to checkout
      </Button>
    </div>
  );
}

function OrganizationPlan() {
  const { organization } = useOrganization();
  const openPortal = useAction(api.billingCommands.openPortal);
  const checkoutState = useAction(api.billingCommands.checkoutState);
  const { accountId } = organization;
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
  const subscription =
    view.kind === "exempt" || view.kind === "provider_managed" || view.kind === "choose_plan"
      ? view.subscription
      : null;
  const notice = subscription === null ? null : subscriptionNotice(subscription);
  const discount = organization.subscription?.discount ?? null;

  const items: BillingSummaryItem[] = [];
  if (subscription !== null) {
    items.push({ label: "Current plan", value: planSummary(subscription), testId: "text-billing-plan" });
    items.push({ label: "State", value: stateLabel(subscription), testId: "text-billing-state" });
  }
  if (discount !== null) {
    items.push({ label: "Discount", value: discount.label, testId: "text-active-discount" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {checkoutReturn.kind === "cancelled" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-checkout-cancelled">
            {CHECKOUT_CANCELLED_TEXT}
          </p>
        ) : null}
        {checkoutReturn.kind === "done" && view.kind !== "no_subscription_needed" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-checkout-done">
            {poll === null
              ? "Thanks! Your payment is being confirmed, and your plan updates here in a moment."
              : CHECKOUT_POLL_TEXT[poll.phase]}
          </p>
        ) : null}
        {view.kind === "no_subscription_needed" ? (
          <p data-testid="text-no-subscription-needed">No subscription needed for self-hosted engines.</p>
        ) : null}
        {view.kind === "no_plan" ? <p>Your hosted engine has no plan yet.</p> : null}
        {items.length > 0 ? <BillingSummary items={items} /> : null}
        {notice ? <StatusBanner tone="warning">{notice}</StatusBanner> : null}
        {view.kind === "provider_managed" ? (
          <ProviderRedirectButton
            label="Manage billing"
            testId="button-manage-billing"
            open={() => openPortal({ accountId: organization.accountId })}
          />
        ) : null}
        {view.kind === "choose_plan" || view.kind === "no_plan" ? <PlanChooser /> : null}
      </CardContent>
    </Card>
  );
}

/** For a viewer with no organization, such as a sponsor: the way to a streaming engine of their own. */
function SetUpEngineCard() {
  return (
    <Card data-testid="card-set-up-engine">
      <CardHeader>
        <CardTitle>Stream with woofx3</CardTitle>
        <CardDescription>
          Want alerts, overlays and chat commands on your own stream? Set up a streaming engine and we&apos;ll walk you
          through it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/auth/onboarding" data-testid="link-set-up-engine">
            Set up a streaming engine
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function PlanPage() {
  const selection = useOptionalOrganization();
  const organization = selection?.organization ?? null;
  const rename = useMutation(api.organizations.rename);
  return (
    <>
      <PageHeader
        title="Plan"
        description="What you pay for on woofx3."
        actions={
          organization?.can.renameOrganization ? (
            <RenameDialog
              title="Rename organization"
              current={organization.name}
              onRename={(name) => rename({ accountId: organization.accountId, name })}
              testId="button-rename-organization"
            />
          ) : null
        }
      />
      <div className="space-y-6">
        {organization?.can.manageBilling ? <OrganizationPlan /> : null}
        <SponsorshipSection />
        {selection === null ? <SetUpEngineCard /> : null}
      </div>
    </>
  );
}
