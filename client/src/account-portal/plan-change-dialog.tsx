import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PlanChangeOutcome, PlanChangePreview } from "@convex/lib/billingClient";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCents, formatDay, planName } from "@/billing/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";

export interface PlanChangeTarget {
  plan: PlanTier;
  interval: BillingInterval;
}

const INTERVAL_WORD: Record<BillingInterval, string> = { month: "monthly", year: "yearly" };
const INTERVAL_SUFFIX: Record<BillingInterval, string> = { month: "/mo", year: "/yr" };

type PreviewState =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; preview: PlanChangePreview };

/** A recurring price as the plan cards show it: whole dollars without the cents. */
function recurring(cents: number, interval: BillingInterval): string {
  return `${formatCents(cents).replace(/\.00$/, "")}${INTERVAL_SUFFIX[interval]}`;
}

/** A charge the card is asked for is a plain amount; a credit shows its minus. */
function signed(cents: number): string {
  return cents < 0 ? `-${formatCents(-cents)}` : formatCents(cents);
}

/** Said after the change: what happened and, for a booked move, when. */
export function outcomeText(outcome: PlanChangeOutcome, names: Readonly<Record<string, string>>): string {
  switch (outcome.kind) {
    case "applied":
      return "Your plan was changed.";
    case "scheduled":
      return `You'll move to ${planName(names, outcome.change.plan)} on ${formatDay(outcome.change.at)}.`;
    case "kept":
      return "The scheduled change was cancelled. You're staying on your plan.";
  }
}

interface PlanChangeDialogProps {
  accountId: Id<"accounts">;
  target: PlanChangeTarget;
  names: Readonly<Record<string, string>>;
  onClose: () => void;
  onChanged: (outcome: PlanChangeOutcome) => void;
}

/**
 * Asks the plane what a move would charge before anything is changed, shows it, and makes the move on confirm.
 * Up is charged now: the dialog lists the credit for the unused time and the charge for the rest of the period, and
 * the total. Down charges nothing and starts when the paid period ends.
 */
export function PlanChangeDialog({ accountId, target, names, onClose, onChanged }: PlanChangeDialogProps) {
  const previewPlanChange = useAction(api.billingCommands.previewPlanChange);
  const changePlan = useAction(api.billingCommands.changePlan);
  const [preview, setPreview] = useState<PreviewState>({ state: "loading" });
  const [saving, setSaving] = useState(false);
  const { plan, interval } = target;

  useEffect(() => {
    let current = true;
    setPreview({ state: "loading" });
    previewPlanChange({ accountId, plan, interval }).then(
      (result) => current && setPreview({ state: "ready", preview: result }),
      (error: unknown) => current && setPreview({ state: "failed", message: actionErrorMessage(error) })
    );
    return () => {
      current = false;
    };
  }, [previewPlanChange, accountId, plan, interval]);

  async function confirm() {
    setSaving(true);
    try {
      const outcome = await changePlan({ accountId, plan, interval });
      toast({ title: outcomeText(outcome, names) });
      onChanged(outcome);
    } catch (error) {
      toast({ title: "Could not change your plan", description: actionErrorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const label = `${planName(names, plan)}, ${INTERVAL_WORD[interval]}`;
  const ready = preview.state === "ready" ? preview.preview : null;
  const chargedNow = ready !== null && ready.timing === "now";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="dialog-plan-change">
        <DialogHeader>
          <DialogTitle>Switch to {label}</DialogTitle>
          <DialogDescription>
            {chargedNow
              ? "This takes effect now. Here is what you'll be charged."
              : "Review the change before you confirm."}
          </DialogDescription>
        </DialogHeader>
        {preview.state === "loading" ? (
          <p
            className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
            data-testid="text-plan-change-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Working out the charge...
          </p>
        ) : null}
        {preview.state === "failed" ? (
          <p className="py-4 text-sm text-destructive" data-testid="text-plan-change-failed">
            {preview.message}
          </p>
        ) : null}
        {ready !== null ? (
          <div className="space-y-4 py-2 text-sm" data-testid="section-plan-change-preview">
            {chargedNow ? (
              <>
                <ul className="divide-y rounded-md border">
                  {ready.lines.map((line) => (
                    <li
                      key={line.description}
                      className="flex justify-between gap-4 px-3 py-2"
                      data-testid="row-plan-change-line"
                    >
                      <span>{line.description}</span>
                      <span className="tabular-nums">{signed(line.amountCents)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-4 px-3 py-2 font-medium">
                    <span>Due today</span>
                    <span className="tabular-nums" data-testid="text-plan-change-due">
                      {formatCents(Math.max(0, ready.dueNowCents))}
                    </span>
                  </li>
                </ul>
                <p className="text-muted-foreground" data-testid="text-plan-change-next">
                  Then {recurring(ready.next.amountCents, interval)} from {formatDay(ready.next.at)}.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium" data-testid="text-plan-change-due">
                  No charge today.
                </p>
                <p className="text-muted-foreground" data-testid="text-plan-change-next">
                  You keep your current plan until {formatDay(ready.effectiveAt)}. From then on it's{" "}
                  {recurring(ready.next.amountCents, interval)}.
                </p>
              </>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={ready === null || saving} data-testid="button-confirm-plan-change">
            {ready === null
              ? "Confirm"
              : chargedNow
                ? `Pay ${formatCents(Math.max(0, ready.dueNowCents))} and switch`
                : `Switch on ${formatDay(ready.effectiveAt)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
