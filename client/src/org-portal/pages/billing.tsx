import { api } from "@convex/_generated/api";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { AppliedDiscount } from "@convex/lib/payments/provider";
import type { OrgSubscription } from "@convex/organizations";
import { useAction } from "convex/react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { billingView } from "../billing-view";
import { describeDiscount, formatPrice, PLAN_NAMES } from "../format";
import { useOrganization } from "../organization-context";
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

function SubscriptionSummary({ subscription }: { subscription: OrgSubscription }) {
  const notice = subscriptionNotice(subscription);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current</p>
          <p className="font-medium" data-testid="text-billing-plan">
            {planLabel(subscription)}
            {subscription.interval ? ` - ${formatPrice(subscription.plan, subscription.interval)}` : ""}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">State</p>
          <p className="font-medium" data-testid="text-billing-state">
            {stateLabel(subscription)}
          </p>
        </div>
      </div>
      {notice ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <p>{notice}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Sends the browser to a provider page: checkout or the customer portal. */
function useProviderRedirect() {
  const [busy, setBusy] = useState(false);
  async function go(open: () => Promise<{ url: string }>) {
    setBusy(true);
    try {
      const { url } = await open();
      window.location.assign(url);
    } catch (error) {
      toast({ title: "Billing is unavailable", description: actionErrorMessage(error), variant: "destructive" });
      setBusy(false);
    }
  }
  return { busy, go };
}

function ManageBillingButton() {
  const { organization } = useOrganization();
  const openPortal = useAction(api.billing.openPortal);
  const { busy, go } = useProviderRedirect();
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => go(() => openPortal({ accountId: organization.accountId }))}
      data-testid="button-manage-billing"
    >
      Manage billing
      <ExternalLink className="h-4 w-4 ml-2" />
    </Button>
  );
}

function PlanChooser() {
  const { organization } = useOrganization();
  const startCheckout = useAction(api.billing.startCheckout);
  const previewPromotionCode = useAction(api.billing.previewPromotionCode);
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
      <div className="space-y-2">
        <Label htmlFor="promotion-code">Promotion code</Label>
        <div className="flex gap-2 max-w-sm">
          <Input
            id="promotion-code"
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
      </div>
      <Button
        disabled={busy}
        onClick={() =>
          go(() =>
            startCheckout({
              accountId: organization.accountId,
              plan: selected.plan,
              interval: selected.interval,
              promotionCode,
            })
          )
        }
        data-testid="button-continue-to-checkout"
      >
        Continue to checkout
      </Button>
    </div>
  );
}

export default function BillingPage() {
  const { organization } = useOrganization();
  const checkoutDone = new URLSearchParams(useSearch()).get("checkout") === "done";
  const view = billingView(organization);
  const isOwner = organization.can.manageBilling;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan & billing</CardTitle>
        {isOwner ? null : <CardDescription>Only the organization&apos;s owner changes the plan.</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-6">
        {checkoutDone && view.kind !== "no_subscription_needed" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-checkout-done">
            Thanks! Your payment is being confirmed, and your plan updates here in a moment.
          </p>
        ) : null}
        {view.kind === "no_subscription_needed" ? (
          <p data-testid="text-no-subscription-needed">No subscription needed for self-hosted engines.</p>
        ) : null}
        {view.kind === "no_plan" ? <p>Your hosted engine has no plan yet.</p> : null}
        {view.kind === "exempt" ? <SubscriptionSummary subscription={view.subscription} /> : null}
        {view.kind === "provider_managed" ? (
          <>
            <SubscriptionSummary subscription={view.subscription} />
            {isOwner ? <ManageBillingButton /> : null}
          </>
        ) : null}
        {view.kind === "choose_plan" ? <SubscriptionSummary subscription={view.subscription} /> : null}
        {(view.kind === "choose_plan" || view.kind === "no_plan") && isOwner ? <PlanChooser /> : null}
      </CardContent>
    </Card>
  );
}
