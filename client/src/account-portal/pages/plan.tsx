import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AppliedDiscount } from "@convex/lib/billingClient";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { OrgSubscription } from "@convex/organizations";
import { useAction, useMutation } from "convex/react";
import { useEffect, useReducer, useState } from "react";
import { useSearch } from "wouter";
import { BillingSummary, type BillingSummaryItem } from "@/billing/billing-summary";
import { describeDiscount, formatPrice, PLAN_NAMES } from "@/billing/format";
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
import {
  CHECKOUT_CANCELLED_TEXT,
  CHECKOUT_POLL,
  CHECKOUT_POLL_TEXT,
  type CheckoutPoll,
  type CheckoutPollEvent,
  INITIAL_CHECKOUT_POLL,
  nextCheckoutPoll,
  parseCheckoutReturn,
} from "@/lib/checkout-return";
import { billingView, checkoutRefusalAction } from "../billing-view";
import { useOrganization } from "../organization-context";
import { RenameDialog } from "../rename-dialog";
import { planLabel, stateLabel, subscriptionNotice } from "../subscription-text";

const PLAN_CHOICES: Array<{ plan: PlanTier; interval: BillingInterval; note?: string }> = [
  { plan: "starter", interval: "month" },
  { plan: "starter", interval: "year", note: "2 months free" },
  { plan: "pro", interval: "month" },
  { plan: "pro", interval: "year", note: "2 months free" },
];

function choiceKey(plan: PlanTier, interval: BillingInterval): string {
  return `${plan}_${interval}`;
}

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
  const [choice, setChoice] = useState(choiceKey("starter", "month"));
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ code: string; discount: AppliedDiscount | null } | null>(null);
  const { busy, go } = useProviderRedirect();
  const selected = PLAN_CHOICES.find((option) => choiceKey(option.plan, option.interval) === choice) ?? PLAN_CHOICES[0];

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
      <RadioGroup value={choice} onValueChange={setChoice} className="grid gap-3 sm:grid-cols-2">
        {PLAN_CHOICES.map(({ plan, interval, note }) => {
          const key = choiceKey(plan, interval);
          return (
            <Label
              key={key}
              htmlFor={`plan-${key}`}
              className="flex items-center gap-3 rounded-md border p-3 cursor-pointer font-normal"
            >
              <RadioGroupItem id={`plan-${key}`} value={key} data-testid={`radio-plan-${key}`} />
              <span className="font-medium">{PLAN_NAMES[plan]}</span>
              <span>{formatPrice(plan, interval)}</span>
              {note ? <span className="text-xs text-muted-foreground">({note})</span> : null}
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
                plan: selected.plan,
                interval: selected.interval,
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

/** Asks the plane how the checkout the customer just paid for stands until it settles or the bound is reached. */
function useCheckoutPoll(
  accountId: Id<"accounts">,
  checkoutId: string | null,
  reflected: boolean
): CheckoutPoll | null {
  const checkoutState = useAction(api.billingCommands.checkoutState);
  const [poll, dispatch] = useReducer(
    (current: CheckoutPoll, event: CheckoutPollEvent) => nextCheckoutPoll(current, event, CHECKOUT_POLL.maxAttempts),
    INITIAL_CHECKOUT_POLL
  );
  const settled = poll.phase !== "polling";
  const attempts = poll.phase === "polling" ? poll.attempts : -1;
  useEffect(() => {
    if (checkoutId === null || settled) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        let event: CheckoutPollEvent;
        try {
          event = { type: "answered", state: (await checkoutState({ accountId, checkoutId })).state, reflected };
        } catch {
          // A failed ask is one spent attempt; the bound ends the polling.
          event = { type: "failed" };
        }
        if (!cancelled) {
          dispatch(event);
        }
      },
      attempts === 0 ? 0 : CHECKOUT_POLL.intervalMs
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, checkoutId, checkoutState, settled, attempts, reflected]);
  return checkoutId === null ? null : poll;
}

export default function PlanPage() {
  const { organization } = useOrganization();
  const rename = useMutation(api.organizations.rename);
  const openPortal = useAction(api.billingCommands.openPortal);
  const checkoutReturn = parseCheckoutReturn(useSearch());
  const view = billingView(organization);
  const poll = useCheckoutPoll(
    organization.accountId,
    checkoutReturn.kind === "done" ? checkoutReturn.checkoutId : null,
    view.kind === "provider_managed"
  );
  const isOwner = organization.can.manageBilling;
  const subscription =
    view.kind === "exempt" || view.kind === "provider_managed" || view.kind === "choose_plan"
      ? view.subscription
      : null;
  const notice = subscription === null ? null : subscriptionNotice(subscription);
  // The owner is the only one the query gives a discount to.
  const discount = isOwner ? (organization.subscription?.discount ?? null) : null;

  const items: BillingSummaryItem[] = [];
  if (subscription !== null) {
    items.push({ label: "Current plan", value: planSummary(subscription), testId: "text-billing-plan" });
    items.push({ label: "State", value: stateLabel(subscription), testId: "text-billing-state" });
  }
  if (discount !== null) {
    items.push({ label: "Discount", value: discount.label, testId: "text-active-discount" });
  }

  return (
    <>
      <PageHeader
        title="Plan"
        description="The plan this organization is on and what it pays."
        actions={
          organization.can.renameOrganization ? (
            <RenameDialog
              title="Rename organization"
              current={organization.name}
              onRename={(name) => rename({ accountId: organization.accountId, name })}
              testId="button-rename-organization"
            />
          ) : null
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          {isOwner ? null : <CardDescription>Only the organization&apos;s owner changes the plan.</CardDescription>}
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
          {view.kind === "provider_managed" && isOwner ? (
            <ProviderRedirectButton
              label="Manage billing"
              testId="button-manage-billing"
              open={() => openPortal({ accountId: organization.accountId })}
            />
          ) : null}
          {(view.kind === "choose_plan" || view.kind === "no_plan") && isOwner ? <PlanChooser /> : null}
        </CardContent>
      </Card>
    </>
  );
}
