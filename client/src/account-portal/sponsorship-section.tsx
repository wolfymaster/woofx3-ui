import { api } from "@convex/_generated/api";
import type { Sponsorship } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { BillingSummary, type BillingSummaryItem } from "@/billing/billing-summary";
import { ConfirmDialog } from "@/billing/confirm-dialog";
import { formatDay } from "@/billing/format";
import { ProviderRedirectButton } from "@/billing/provider-redirect";
import { StatusBanner } from "@/billing/status-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";
import { useCheckoutPoll } from "@/lib/use-checkout-poll";
import { amountProblem, dollarsText, parseDollars } from "@/sponsorship/amount";
import { AmountField } from "@/sponsorship/amount-field";
import {
  PAYMENT_METHOD_UPDATED_TEXT,
  parseSponsorshipReturn,
  paymentMethodReturned,
  SPONSORSHIP_CANCELLED_TEXT,
  SPONSORSHIP_POLL_TEXT,
  SPONSORSHIP_UNTRACKED_TEXT,
  withoutPaymentMethodReturn,
} from "@/sponsorship/sponsorship-return";
import {
  amountSummary,
  INTERVAL_LABELS,
  isManageable,
  SPONSOR_START_PATH,
  sponsorshipNotice,
  stateLabel,
} from "@/sponsorship/sponsorship-text";
import { useSponsorshipTerms } from "@/sponsorship/use-sponsorship-terms";
import { type SponsorshipList, useSponsorships } from "./use-sponsorships";

function ChangeAmountDialog({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  const changeAmount = useAction(api.sponsorships.changeAmount);
  const terms = useSponsorshipTerms();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(dollarsText(sponsorship.amountCents));
  const [saving, setSaving] = useState(false);
  const cents = parseDollars(text);
  const valid =
    terms.state === "ready" &&
    cents !== null &&
    cents !== sponsorship.amountCents &&
    amountProblem(cents, terms.terms) === null;

  async function save() {
    if (cents === null) {
      return;
    }
    setSaving(true);
    try {
      await changeAmount({ sponsorshipId: sponsorship.id, amountCents: cents });
      setOpen(false);
      onChanged();
    } catch (error) {
      toast({ title: "Could not change the amount", description: actionErrorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid={`button-change-amount-${sponsorship.id}`}>
          Change amount
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your monthly amount</DialogTitle>
          <DialogDescription>The new amount applies from your next payment.</DialogDescription>
        </DialogHeader>
        {terms.state === "loading" ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
        {terms.state === "failed" ? <p className="text-sm text-destructive">{terms.message}</p> : null}
        {terms.state === "ready" ? (
          <AmountField
            id={`amount-${sponsorship.id}`}
            text={text}
            onTextChange={setText}
            terms={terms.terms}
            testId={`input-amount-${sponsorship.id}`}
          />
        ) : null}
        <DialogFooter>
          <Button disabled={!valid || saving} onClick={save} data-testid={`button-save-amount-${sponsorship.id}`}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SponsorshipCard({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  const cancel = useAction(api.sponsorships.cancel);
  const paymentMethodSession = useAction(api.sponsorships.paymentMethodSession);
  const notice = sponsorshipNotice(sponsorship);
  const items: BillingSummaryItem[] = [
    { label: "Amount", value: amountSummary(sponsorship), testId: "text-sponsorship-amount" },
    { label: "Type", value: INTERVAL_LABELS[sponsorship.interval] },
    { label: "State", value: stateLabel(sponsorship), testId: "text-sponsorship-state" },
    { label: "Since", value: formatDay(sponsorship.createdAt) },
  ];
  if (sponsorship.interval === "month" && sponsorship.currentPeriodEnd !== null && !sponsorship.cancelAtPeriodEnd) {
    items.push({ label: "Next payment", value: formatDay(sponsorship.currentPeriodEnd) });
  }

  async function confirmCancel() {
    try {
      await cancel({ sponsorshipId: sponsorship.id });
      onChanged();
    } catch (error) {
      toast({ title: "Could not cancel", description: actionErrorMessage(error), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4" data-testid={`sponsorship-${sponsorship.id}`}>
      <BillingSummary items={items} />
      {notice === null ? null : <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner>}
      {isManageable(sponsorship) ? (
        <div className="flex flex-wrap gap-2">
          <ChangeAmountDialog sponsorship={sponsorship} onChanged={onChanged} />
          <ProviderRedirectButton
            label="Update payment method"
            testId={`button-update-payment-method-${sponsorship.id}`}
            open={() => paymentMethodSession({ sponsorshipId: sponsorship.id })}
          />
          <ConfirmDialog
            trigger={
              <Button variant="outline" data-testid={`button-cancel-sponsorship-${sponsorship.id}`}>
                Cancel sponsorship
              </Button>
            }
            title="Cancel your sponsorship?"
            description={
              sponsorship.currentPeriodEnd === null
                ? "Your sponsorship will stop. You can sponsor again any time."
                : `Your sponsorship stays active until ${formatDay(sponsorship.currentPeriodEnd)}, then stops. You can sponsor again any time.`
            }
            confirmLabel="Cancel sponsorship"
            dismissLabel="Keep sponsorship"
            destructive
            onConfirm={confirmCancel}
            testId={`button-confirm-cancel-${sponsorship.id}`}
          />
        </div>
      ) : null}
    </div>
  );
}

/** What the page says about the checkout the sponsor just left; it confirms only what the plane has confirmed. */
function ReturnNotice({ onConfirmed }: { onConfirmed: () => void }) {
  const checkoutState = useAction(api.sponsorships.checkoutState);
  const sponsorshipReturn = parseSponsorshipReturn(useSearch());
  const ask = useCallback(async (checkoutId: string) => (await checkoutState({ checkoutId })).state, [checkoutState]);
  const poll = useCheckoutPoll(ask, sponsorshipReturn.kind === "done" ? sponsorshipReturn.checkoutId : null, true);
  const phase = poll?.phase;
  useEffect(() => {
    if (phase === "complete") {
      onConfirmed();
    }
  }, [phase, onConfirmed]);

  if (sponsorshipReturn.kind === "cancelled") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-sponsorship-cancelled">
        {SPONSORSHIP_CANCELLED_TEXT}
      </p>
    );
  }
  if (sponsorshipReturn.kind === "done") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-sponsorship-done">
        {poll === null ? SPONSORSHIP_UNTRACKED_TEXT : SPONSORSHIP_POLL_TEXT[poll.phase]}
      </p>
    );
  }
  return null;
}

/** Confirms a return from the card-update page once, then drops the marker from the address. */
function PaymentMethodNotice() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const [returned] = useState(() => paymentMethodReturned(search));
  useEffect(() => {
    if (paymentMethodReturned(search)) {
      navigate(`${location}${withoutPaymentMethodReturn(search)}`, { replace: true });
    }
  }, [search, location, navigate]);
  return returned ? (
    <p className="text-sm text-muted-foreground" data-testid="text-payment-method-updated">
      {PAYMENT_METHOD_UPDATED_TEXT}
    </p>
  ) : null;
}

function SponsorshipBody({ list }: { list: SponsorshipList }) {
  if (list.state === "loading") {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (list.state === "failed") {
    return <p className="text-sm text-destructive">{list.message}</p>;
  }
  return null;
}

/** The viewer's own sponsorships; until they sponsor, a pitch and a way to start. */
export function SponsorshipSection() {
  const { list, reload } = useSponsorships();
  const sponsorships = list.state === "ready" ? list.sponsorships : [];
  return (
    <Card data-testid="card-sponsorship">
      <CardHeader>
        <CardTitle>Your sponsorship</CardTitle>
        {list.state === "ready" && sponsorships.length === 0 ? (
          <CardDescription>
            You aren&apos;t sponsoring woofx3 yet. A sponsorship supports the project, and it shows up here.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <ReturnNotice onConfirmed={reload} />
        <PaymentMethodNotice />
        <SponsorshipBody list={list} />
        {sponsorships.map((sponsorship) => (
          <SponsorshipCard key={sponsorship.id} sponsorship={sponsorship} onChanged={reload} />
        ))}
        {list.state === "ready" && sponsorships.length === 0 ? (
          <Button asChild variant="outline">
            <Link href={SPONSOR_START_PATH} data-testid="link-become-sponsor">
              Become a sponsor
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
