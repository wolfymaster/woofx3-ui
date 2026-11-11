import type { LocalEndpointSummary } from "@shared/local-endpoints";
import type {
  InstallAcquireOutcome,
  InstallRefusalReason,
  LicensedInstallOutcome,
  MarketplacePurchaseIntent,
} from "@/engine/types";
import { OWNER_MUST_PURCHASE_MESSAGE } from "@/lib/marketplace-access";
import type { PaymentStart } from "@/lib/marketplace-payment";

// One marketplace install, as a state machine: consent, then holding the
// listing (a claim, or a payment), then the engine's install. Consent comes
// first, so a streamer who backs out of the permission prompt has claimed
// nothing. `transition` is pure: it says what state an event leads to and
// which command to run next, and the hook running it does nothing else. Every
// command is safe to repeat, so after a reload the flow starts again from what
// the marketplace and the engine say, not from anything kept here.

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
  /** The purchase could not be started. */
  | "payment_unavailable"
  /** The listing costs money and the streamer is not the organization's owner. */
  | "owner_must_purchase"
  /** Back from paying, but the marketplace does not show the purchase yet. */
  | "payment_pending"
  /** The build asks for access the streamer was not shown. */
  | "needs_approval"
  | "install_failed";

export type InstallFlowState =
  | { step: "idle" }
  | { step: "consenting"; approval: InstallApproval; prompt: ConsentPrompt }
  | { step: "acquiring"; approval: InstallApproval }
  | { step: "needs_payment"; approval: InstallApproval; intent: MarketplacePurchaseIntent }
  | { step: "finalizing_payment"; listingId: string }
  /** Held after a payment, waiting for the streamer to install it. */
  | { step: "licensed"; listingId: string }
  /** `moduleKey` is null until the engine accepts the build. */
  | { step: "installing"; approval: InstallApproval; moduleKey: string | null }
  | { step: "installed"; moduleKey: string }
  /** `message` is written for the streamer. */
  | { step: "failed"; reason: InstallFailureReason; message: string };

export type InstallFlowStep = InstallFlowState["step"];

export type InstallFlowEvent =
  /** `prompt` is null when the install allows nothing new. */
  | { type: "install_requested"; approval: InstallApproval; prompt: ConsentPrompt | null }
  | { type: "consent_given" }
  | { type: "consent_withdrawn" }
  | { type: "acquire_answered"; outcome: InstallAcquireOutcome }
  | { type: "payment_answered"; outcome: PaymentStart }
  /** The browser came back from paying for `listingId`. */
  | { type: "payment_returned"; listingId: string }
  | { type: "install_answered"; outcome: LicensedInstallOutcome }
  /** What the engine reported for the build it accepted. */
  | { type: "install_reported"; outcome: { status: "succeeded" } | { status: "failed"; message: string } }
  /** A command failed outright. */
  | { type: "command_failed"; message: string }
  | { type: "dismissed" };

export type InstallCommand =
  | { kind: "acquire"; listingId: string }
  | { kind: "start_payment"; listingId: string; intent: MarketplacePurchaseIntent }
  | { kind: "open_checkout"; url: string }
  | { kind: "install"; approval: InstallApproval; licenseKey: string | null };

export interface InstallTransition {
  state: InstallFlowState;
  command: InstallCommand | null;
}

export const INSTALL_FLOW_IDLE: InstallFlowState = { step: "idle" };

const NEEDS_APPROVAL_MESSAGE =
  "This module now asks for access you haven't been shown. Reload the page to review it, then install again.";
const PAYMENT_PENDING_MESSAGE = "Your purchase is still being confirmed. Reload the page in a moment, then install it.";

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

function acquireAnswered(state: InstallFlowState, outcome: InstallAcquireOutcome): InstallTransition {
  if (state.step === "finalizing_payment") {
    switch (outcome.status) {
      case "licensed":
        return stay({ step: "licensed", listingId: state.listingId });
      case "payment_required":
        return failed("payment_pending", PAYMENT_PENDING_MESSAGE);
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

function paymentAnswered(state: InstallFlowState, outcome: PaymentStart): InstallTransition {
  if (state.step !== "needs_payment") {
    return stay(state);
  }
  switch (outcome.status) {
    case "redirect":
      return { state, command: { kind: "open_checkout", url: outcome.url } };
    case "settled":
      return acquire(state.approval);
    case "unavailable":
      return failed("payment_unavailable", outcome.message);
  }
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
      return paymentAnswered(state, event.outcome);

    case "payment_returned":
      if (installFlowBusy(state)) {
        return stay(state);
      }
      return {
        state: { step: "finalizing_payment", listingId: event.listingId },
        command: { kind: "acquire", listingId: event.listingId },
      };

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
      return installFlowBusy(state) ? failed("install_failed", event.message) : stay(state);

    case "dismissed":
      return state.step === "failed" || state.step === "installed" || state.step === "licensed"
        ? stay(INSTALL_FLOW_IDLE)
        : stay(state);
  }
}
