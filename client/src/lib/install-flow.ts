import type { LocalEndpointSummary } from "@shared/local-endpoints";
import type {
  InstallAcquireOutcome,
  InstallRefusalReason,
  LicensedInstallOutcome,
  MarketplacePurchaseIntent,
  PurchaseCheckoutState,
} from "@/engine/types";
import { CHECKOUT_POLL } from "@/lib/checkout-return";
import { OWNER_MUST_PURCHASE_MESSAGE } from "@/lib/marketplace-access";

// One marketplace install, as a state machine: consent, then holding the
// listing (a claim, or a payment), then the engine's install. Consent comes
// first, so a streamer who backs out of the permission prompt has claimed
// nothing. `transition` is pure: it says what state an event leads to and
// which command to run next, and the hook running it does nothing else. Every
// command is safe to repeat, so after a reload the flow starts again from what
// the marketplace and the engine say, not from anything kept here.
//
// Back from paying, the flow follows billing's checkout until it is paid, then
// acquires again until the marketplace has granted the listing (billing grants
// it after the payment, a separate step). Both waits share one bound
// (`CHECKOUT_POLL`); past it the streamer is told the payment is still being
// confirmed and can check again, since nothing was lost.

/** What the install sends: every permission and local endpoint id the streamer approved for the build. */
export interface InstallApproval {
  listingId: string;
  /** Named in the approval dialog. */
  moduleName: string;
  mode: "install" | "update";
  permissions: string[];
  localEndpoints: string[];
  /** Whether the streamer may start a payment, which only the organization's owner may. */
  canPay: boolean;
  /**
   * The local endpoints the build is known to declare, so an engine asking
   * for one by id can be shown to the streamer by name.
   */
  knownLocalEndpoints: LocalEndpointSummary[];
}

/** What the approval dialog asks for: only what this install newly allows. */
export interface ConsentPrompt {
  permissions: string[];
  localEndpoints: LocalEndpointSummary[];
}

export type InstallFailureReason =
  | InstallRefusalReason
  /** Billing would not start the payment; the message says why. */
  | "payment_unavailable"
  /** The listing costs money and the streamer is not the organization's owner. */
  | "owner_must_purchase"
  /** Back from paying, but the payment or the grant was not confirmed within the bound; checking again is safe. */
  | "payment_pending"
  /** The checkout expired unpaid. */
  | "payment_expired"
  /** Paid, but billing could not grant the listing; support settles it. */
  | "payment_needs_review"
  /** The build asks for access the streamer was not shown. */
  | "needs_approval"
  | "install_failed";

export type InstallFlowState =
  | { step: "idle" }
  | { step: "consenting"; approval: InstallApproval; prompt: ConsentPrompt }
  | { step: "acquiring"; approval: InstallApproval }
  | { step: "needs_payment"; approval: InstallApproval; intent: MarketplacePurchaseIntent }
  /**
   * Back from paying. `phase` is what is awaited: billing's checkout to be
   * paid (`checkout`), then the marketplace to grant the listing
   * (`entitlement`). `checkoutId` is null for a return that names none, which
   * waits on the grant alone. `attempts` counts asks toward `CHECKOUT_POLL`.
   */
  | { step: "finalizing_payment"; purchase: PendingPurchase; phase: "checkout" | "entitlement"; attempts: number }
  /** Held after a payment, waiting for the streamer to install it. */
  | { step: "licensed"; listingId: string }
  /** `moduleKey` is null until the engine accepts the build. */
  | { step: "installing"; approval: InstallApproval; moduleKey: string | null }
  | { step: "installed"; moduleKey: string }
  /**
   * `message` is written for the streamer. `purchase` is set for a payment
   * still being confirmed, which `purchase_rechecked` follows again.
   */
  | { step: "failed"; reason: InstallFailureReason; message: string; purchase?: PendingPurchase };

/** A purchase the browser came back from paying for. */
export interface PendingPurchase {
  listingId: string;
  checkoutId: string | null;
}

export type InstallFlowStep = InstallFlowState["step"];

export type InstallFlowEvent =
  /** `prompt` is null when the install allows nothing new. */
  | { type: "install_requested"; approval: InstallApproval; prompt: ConsentPrompt | null }
  | { type: "consent_given" }
  | { type: "consent_withdrawn" }
  | { type: "acquire_answered"; outcome: InstallAcquireOutcome }
  /** Billing opened the checkout to pay at `url`. */
  | { type: "payment_answered"; url: string }
  /** The browser came back from paying. */
  | { type: "payment_returned"; purchase: PendingPurchase }
  /** The streamer asks again about a payment that was still being confirmed. */
  | { type: "purchase_rechecked" }
  | { type: "checkout_answered"; state: PurchaseCheckoutState }
  | { type: "install_answered"; outcome: LicensedInstallOutcome }
  /** What the engine reported for the build it accepted. */
  | { type: "install_reported"; outcome: { status: "succeeded" } | { status: "failed"; message: string } }
  /** A command failed outright. */
  | { type: "command_failed"; message: string }
  | { type: "dismissed" };

/** `afterMs`, when set, is how long to wait before running the command. */
export type InstallCommand =
  | { kind: "acquire"; listingId: string; afterMs?: number }
  | { kind: "start_payment"; listingId: string; intent: MarketplacePurchaseIntent }
  | { kind: "open_checkout"; url: string }
  | { kind: "read_checkout"; checkoutId: string; afterMs?: number }
  | { kind: "install"; approval: InstallApproval; licenseKey: string | null };

export interface InstallTransition {
  state: InstallFlowState;
  command: InstallCommand | null;
}

export const INSTALL_FLOW_IDLE: InstallFlowState = { step: "idle" };

const NEEDS_APPROVAL_MESSAGE =
  "This module now asks for access you haven't been shown. Reload the page to review it, then install again.";
const PAYMENT_PENDING_MESSAGE =
  "Your payment is still being confirmed. Check again in a minute; you won't be charged twice.";
const PAYMENT_EXPIRED_MESSAGE =
  "That checkout expired before it was paid, so nothing was charged. Buy it again to install it.";
const PAYMENT_NEEDS_REVIEW_MESSAGE =
  "Your payment went through, but the module couldn't be added to your organization. woofx3 support will add it or refund you; contact them if you don't hear back.";

function stay(state: InstallFlowState): InstallTransition {
  return { state, command: null };
}

function failed(reason: InstallFailureReason, message: string): InstallTransition {
  return { state: { step: "failed", reason, message }, command: null };
}

function acquire(approval: InstallApproval): InstallTransition {
  return { state: { step: "acquiring", approval }, command: { kind: "acquire", listingId: approval.listingId } };
}

/**
 * The approval widened by what the engine says the build also asks for, and
 * what to ask the streamer, or null when a local endpoint it names is not one
 * the streamer could be shown by name.
 */
function reconsent(
  approval: InstallApproval,
  unapproved: string[],
  unapprovedLocalEndpoints: string[]
): { approval: InstallApproval; prompt: ConsentPrompt } | null {
  const endpoints: LocalEndpointSummary[] = [];
  for (const id of unapprovedLocalEndpoints) {
    const known = approval.knownLocalEndpoints.find((endpoint) => endpoint.id === id);
    if (known === undefined) {
      return null;
    }
    endpoints.push(known);
  }
  return {
    approval: {
      ...approval,
      permissions: [...new Set([...approval.permissions, ...unapproved])],
      localEndpoints: [...new Set([...approval.localEndpoints, ...unapprovedLocalEndpoints])],
    },
    prompt: { permissions: unapproved, localEndpoints: endpoints },
  };
}

/** Whether a flow is running, so a second install request would trample it. */
export function installFlowBusy(state: InstallFlowState): boolean {
  switch (state.step) {
    case "idle":
    case "licensed":
    case "installed":
    case "failed":
      return false;
    case "consenting":
    case "acquiring":
    case "needs_payment":
    case "finalizing_payment":
    case "installing":
      return true;
  }
}

type FinalizingState = Extract<InstallFlowState, { step: "finalizing_payment" }>;

/** Starts following a purchase from its first ask. */
function finalize(purchase: PendingPurchase): InstallTransition {
  if (purchase.checkoutId === null) {
    return {
      state: { step: "finalizing_payment", purchase, phase: "entitlement", attempts: 0 },
      command: { kind: "acquire", listingId: purchase.listingId },
    };
  }
  return {
    state: { step: "finalizing_payment", purchase, phase: "checkout", attempts: 0 },
    command: { kind: "read_checkout", checkoutId: purchase.checkoutId },
  };
}

/**
 * One ask came back without the answer the phase waits for: ask again after
 * the interval, or, past the bound, say the payment is still being confirmed.
 */
function askAgain(state: FinalizingState): InstallTransition {
  const attempts = state.attempts + 1;
  if (attempts >= CHECKOUT_POLL.maxAttempts) {
    return {
      state: { step: "failed", reason: "payment_pending", message: PAYMENT_PENDING_MESSAGE, purchase: state.purchase },
      command: null,
    };
  }
  const afterMs = CHECKOUT_POLL.intervalMs;
  if (state.phase === "checkout" && state.purchase.checkoutId !== null) {
    return {
      state: { ...state, attempts },
      command: { kind: "read_checkout", checkoutId: state.purchase.checkoutId, afterMs },
    };
  }
  return { state: { ...state, attempts }, command: { kind: "acquire", listingId: state.purchase.listingId, afterMs } };
}

function checkoutAnswered(state: InstallFlowState, checkout: PurchaseCheckoutState): InstallTransition {
  if (state.step !== "finalizing_payment" || state.phase !== "checkout") {
    return stay(state);
  }
  switch (checkout) {
    case "complete":
      return {
        state: { ...state, phase: "entitlement" },
        command: { kind: "acquire", listingId: state.purchase.listingId },
      };
    case "expired":
      return failed("payment_expired", PAYMENT_EXPIRED_MESSAGE);
    case "needs_review":
      return failed("payment_needs_review", PAYMENT_NEEDS_REVIEW_MESSAGE);
    case "open":
    case "awaiting_payment":
      return askAgain(state);
  }
}

function acquireAnswered(state: InstallFlowState, outcome: InstallAcquireOutcome): InstallTransition {
  if (state.step === "finalizing_payment") {
    if (state.phase !== "entitlement") {
      return stay(state);
    }
    switch (outcome.status) {
      case "licensed":
        return stay({ step: "licensed", listingId: state.purchase.listingId });
      case "payment_required":
        return askAgain(state);
      case "refused":
        return failed(outcome.reason, outcome.message);
    }
  }
  if (state.step !== "acquiring") {
    return stay(state);
  }
  switch (outcome.status) {
    case "licensed":
      return {
        state: { step: "installing", approval: state.approval, moduleKey: null },
        command: { kind: "install", approval: state.approval, licenseKey: outcome.licenseKey },
      };
    case "payment_required":
      if (!state.approval.canPay) {
        return failed("owner_must_purchase", OWNER_MUST_PURCHASE_MESSAGE);
      }
      return {
        state: { step: "needs_payment", approval: state.approval, intent: outcome.intent },
        command: { kind: "start_payment", listingId: state.approval.listingId, intent: outcome.intent },
      };
    case "refused":
      return failed(outcome.reason, outcome.message);
  }
}

function paymentAnswered(state: InstallFlowState, url: string): InstallTransition {
  if (state.step !== "needs_payment") {
    return stay(state);
  }
  return { state, command: { kind: "open_checkout", url } };
}

/**
 * The state `event` leads to from `state`, and the command to run. An event
 * that does not belong to the current step, such as the late answer of a
 * flow the streamer has already left, changes nothing.
 */
export function transition(state: InstallFlowState, event: InstallFlowEvent): InstallTransition {
  switch (event.type) {
    case "install_requested":
      if (installFlowBusy(state)) {
        return stay(state);
      }
      if (event.prompt === null) {
        return acquire(event.approval);
      }
      return stay({ step: "consenting", approval: event.approval, prompt: event.prompt });

    case "consent_given":
      return state.step === "consenting" ? acquire(state.approval) : stay(state);

    case "consent_withdrawn":
      return state.step === "consenting" ? stay(INSTALL_FLOW_IDLE) : stay(state);

    case "acquire_answered":
      return acquireAnswered(state, event.outcome);

    case "payment_answered":
      return paymentAnswered(state, event.url);

    case "payment_returned":
      return installFlowBusy(state) ? stay(state) : finalize(event.purchase);

    case "purchase_rechecked":
      return state.step === "failed" && state.purchase !== undefined ? finalize(state.purchase) : stay(state);

    case "checkout_answered":
      return checkoutAnswered(state, event.state);

    case "install_answered": {
      if (state.step !== "installing" || state.moduleKey !== null) {
        return stay(state);
      }
      const { outcome } = event;
      if (outcome.status === "installed") {
        return stay({ step: "installing", approval: state.approval, moduleKey: outcome.moduleKey });
      }
      const next = reconsent(state.approval, outcome.unapproved, outcome.unapprovedLocalEndpoints);
      if (next === null) {
        return failed("needs_approval", NEEDS_APPROVAL_MESSAGE);
      }
      return stay({ step: "consenting", approval: next.approval, prompt: next.prompt });
    }

    case "install_reported": {
      if (state.step !== "installing" || state.moduleKey === null) {
        return stay(state);
      }
      const { outcome } = event;
      if (outcome.status === "succeeded") {
        return stay({ step: "installed", moduleKey: state.moduleKey });
      }
      return failed("install_failed", outcome.message);
    }

    case "command_failed":
      // Asking about a payment that may still settle is retried within the bound rather than failed.
      if (state.step === "finalizing_payment") {
        return askAgain(state);
      }
      if (state.step === "needs_payment") {
        return failed("payment_unavailable", event.message);
      }
      return installFlowBusy(state) ? failed("install_failed", event.message) : stay(state);

    case "dismissed":
      return state.step === "failed" || state.step === "installed" || state.step === "licensed"
        ? stay(INSTALL_FLOW_IDLE)
        : stay(state);
  }
}
