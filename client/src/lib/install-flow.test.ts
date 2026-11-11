import { describe, expect, test } from "bun:test";
import type { MarketplacePurchaseIntent } from "@/engine/types";
import { CHECKOUT_POLL } from "@/lib/checkout-return";
import {
  INSTALL_FLOW_IDLE,
  type InstallApproval,
  type InstallCommand,
  type InstallFlowEvent,
  type InstallFlowState,
  installFlowBusy,
  transition,
} from "./install-flow";

const OBS = { id: "obs", name: "OBS", protocol: "websocket" as const };
const APPROVAL: InstallApproval = {
  listingId: "obs-scenes",
  moduleName: "OBS Scenes",
  mode: "install",
  permissions: ["obs.control"],
  localEndpoints: ["obs"],
  canPay: true,
  knownLocalEndpoints: [OBS],
};
const PROMPT = { permissions: ["obs.control"], localEndpoints: [OBS] };
const INTENT: MarketplacePurchaseIntent = {
  id: "pi_1",
  amountCents: 900,
  currency: "usd",
  kind: "full",
  expiresAt: "2026-11-11T12:00:00Z",
};
const KEY = "obs-scenes:1.0.0:abc1234";

const consenting: InstallFlowState = { step: "consenting", approval: APPROVAL, prompt: PROMPT };
const acquiring: InstallFlowState = { step: "acquiring", approval: APPROVAL };
const needsPayment: InstallFlowState = { step: "needs_payment", approval: APPROVAL, intent: INTENT };
const PURCHASE = { listingId: "obs-scenes", checkoutId: "c1" };
const awaitingCheckout: InstallFlowState = {
  step: "finalizing_payment",
  purchase: PURCHASE,
  phase: "checkout",
  attempts: 0,
};
const awaitingGrant: InstallFlowState = {
  step: "finalizing_payment",
  purchase: PURCHASE,
  phase: "entitlement",
  attempts: 0,
};
const stillPending: InstallFlowState = {
  step: "failed",
  reason: "payment_pending",
  message: "Your payment is still being confirmed. Check again in a minute; you won't be charged twice.",
  purchase: PURCHASE,
};
const installRequested: InstallFlowState = { step: "installing", approval: APPROVAL, moduleKey: null };
const installAccepted: InstallFlowState = { step: "installing", approval: APPROVAL, moduleKey: KEY };

const acquireCommand: InstallCommand = { kind: "acquire", listingId: "obs-scenes" };

interface Case {
  name: string;
  from: InstallFlowState;
  event: InstallFlowEvent;
  to: InstallFlowState;
  command: InstallCommand | null;
}

const cases: Case[] = [
  // consent
  {
    name: "a request that allows something new asks first and claims nothing",
    from: INSTALL_FLOW_IDLE,
    event: { type: "install_requested", approval: APPROVAL, prompt: PROMPT },
    to: consenting,
    command: null,
  },
  {
    name: "a request that allows nothing new goes straight to acquiring",
    from: INSTALL_FLOW_IDLE,
    event: { type: "install_requested", approval: APPROVAL, prompt: null },
    to: acquiring,
    command: acquireCommand,
  },
  {
    name: "a second request while one runs is ignored",
    from: acquiring,
    event: { type: "install_requested", approval: APPROVAL, prompt: null },
    to: acquiring,
    command: null,
  },
  {
    name: "a new request may follow a failure",
    from: { step: "failed", reason: "install_failed", message: "boom" },
    event: { type: "install_requested", approval: APPROVAL, prompt: null },
    to: acquiring,
    command: acquireCommand,
  },
  {
    name: "approving acquires",
    from: consenting,
    event: { type: "consent_given" },
    to: acquiring,
    command: acquireCommand,
  },
  {
    name: "backing out of the prompt claims nothing",
    from: consenting,
    event: { type: "consent_withdrawn" },
    to: INSTALL_FLOW_IDLE,
    command: null,
  },
  // acquire
  {
    name: "a license installs with its key",
    from: acquiring,
    event: { type: "acquire_answered", outcome: { status: "licensed", licenseKey: "W3X-KEY" } },
    to: installRequested,
    command: { kind: "install", approval: APPROVAL, licenseKey: "W3X-KEY" },
  },
  {
    name: "an engine that claims for itself installs without a key",
    from: acquiring,
    event: { type: "acquire_answered", outcome: { status: "licensed", licenseKey: null } },
    to: installRequested,
    command: { kind: "install", approval: APPROVAL, licenseKey: null },
  },
  {
    name: "a listing that costs money starts the payment",
    from: acquiring,
    event: { type: "acquire_answered", outcome: { status: "payment_required", intent: INTENT } },
    to: needsPayment,
    command: { kind: "start_payment", listingId: "obs-scenes", intent: INTENT },
  },
  {
    name: "a member who is not the organization's owner is told the owner must buy it, and no payment starts",
    from: { step: "acquiring", approval: { ...APPROVAL, canPay: false } },
    event: { type: "acquire_answered", outcome: { status: "payment_required", intent: INTENT } },
    to: {
      step: "failed",
      reason: "owner_must_purchase",
      message: "Only the organization's owner can buy this. Ask them to purchase it.",
    },
    command: null,
  },
  {
    name: "a member can still install a listing that costs nothing",
    from: { step: "acquiring", approval: { ...APPROVAL, canPay: false } },
    event: { type: "acquire_answered", outcome: { status: "licensed", licenseKey: "W3X-KEY" } },
    to: { step: "installing", approval: { ...APPROVAL, canPay: false }, moduleKey: null },
    command: { kind: "install", approval: { ...APPROVAL, canPay: false }, licenseKey: "W3X-KEY" },
  },
  {
    name: "a refusal fails with the marketplace's reason",
    from: acquiring,
    event: {
      type: "acquire_answered",
      outcome: { status: "refused", reason: "downloads_blocked", message: "pulled" },
    },
    to: { step: "failed", reason: "downloads_blocked", message: "pulled" },
    command: null,
  },
  {
    name: "a late acquire answer for a flow that ended changes nothing",
    from: INSTALL_FLOW_IDLE,
    event: { type: "acquire_answered", outcome: { status: "licensed", licenseKey: "W3X-KEY" } },
    to: INSTALL_FLOW_IDLE,
    command: null,
  },
  // payment
  {
    name: "a checkout page sends the browser there",
    from: needsPayment,
    event: { type: "payment_answered", url: "https://pay.example/s/1" },
    to: needsPayment,
    command: { kind: "open_checkout", url: "https://pay.example/s/1" },
  },
  {
    name: "a payment billing will not start fails with billing's words",
    from: needsPayment,
    event: { type: "command_failed", message: "That price is about to end. Click Buy again for a fresh one." },
    to: {
      step: "failed",
      reason: "payment_unavailable",
      message: "That price is about to end. Click Buy again for a fresh one.",
    },
    command: null,
  },
  // payment return
  {
    name: "back from paying, the flow follows billing's checkout first",
    from: INSTALL_FLOW_IDLE,
    event: { type: "payment_returned", purchase: PURCHASE },
    to: awaitingCheckout,
    command: { kind: "read_checkout", checkoutId: "c1" },
  },
  {
    name: "a return that names no checkout waits on the grant alone",
    from: INSTALL_FLOW_IDLE,
    event: { type: "payment_returned", purchase: { listingId: "obs-scenes", checkoutId: null } },
    to: {
      step: "finalizing_payment",
      purchase: { listingId: "obs-scenes", checkoutId: null },
      phase: "entitlement",
      attempts: 0,
    },
    command: acquireCommand,
  },
  {
    name: "a checkout not paid yet is asked about again after the interval",
    from: awaitingCheckout,
    event: { type: "checkout_answered", state: "awaiting_payment" },
    to: { ...awaitingCheckout, attempts: 1 },
    command: { kind: "read_checkout", checkoutId: "c1", afterMs: CHECKOUT_POLL.intervalMs },
  },
  {
    name: "an unanswered ask counts toward the bound and asks again",
    from: awaitingCheckout,
    event: { type: "command_failed", message: "offline" },
    to: { ...awaitingCheckout, attempts: 1 },
    command: { kind: "read_checkout", checkoutId: "c1", afterMs: CHECKOUT_POLL.intervalMs },
  },
  {
    name: "a checkout billing does not know for this engine ends the wait at once, with nothing to check again",
    from: awaitingCheckout,
    event: { type: "checkout_not_found" },
    to: {
      step: "failed",
      reason: "payment_elsewhere",
      message:
        "This payment belongs to a different organization or engine. Switch to the engine you bought it on, then open the link again.",
    },
    command: null,
  },
  {
    name: "a late not-found while waiting on the grant changes nothing",
    from: awaitingGrant,
    event: { type: "checkout_not_found" },
    to: awaitingGrant,
    command: null,
  },
  {
    name: "a paid checkout acquires again for the grant",
    from: awaitingCheckout,
    event: { type: "checkout_answered", state: "complete" },
    to: awaitingGrant,
    command: acquireCommand,
  },
  {
    name: "an expired checkout says nothing was charged",
    from: awaitingCheckout,
    event: { type: "checkout_answered", state: "expired" },
    to: {
      step: "failed",
      reason: "payment_expired",
      message: "That checkout expired before it was paid, so nothing was charged. Buy it again to install it.",
    },
    command: null,
  },
  {
    name: "a paid checkout that could not be granted points to support",
    from: awaitingCheckout,
    event: { type: "checkout_answered", state: "needs_review" },
    to: {
      step: "failed",
      reason: "payment_needs_review",
      message:
        "Your payment went through, but the module couldn't be added to your organization. woofx3 support will add it or refund you; contact them if you don't hear back.",
    },
    command: null,
  },
  {
    name: "a late checkout answer while waiting on the grant changes nothing",
    from: awaitingGrant,
    event: { type: "checkout_answered", state: "open" },
    to: awaitingGrant,
    command: null,
  },
  {
    name: "a granted purchase is held and waits for the streamer to install it",
    from: awaitingGrant,
    event: { type: "acquire_answered", outcome: { status: "licensed", licenseKey: "W3X-KEY" } },
    to: { step: "licensed", listingId: "obs-scenes" },
    command: null,
  },
  {
    name: "a grant not there yet acquires again after the interval, and nothing is charged again",
    from: awaitingGrant,
    event: { type: "acquire_answered", outcome: { status: "payment_required", intent: INTENT } },
    to: { ...awaitingGrant, attempts: 1 },
    command: { kind: "acquire", listingId: "obs-scenes", afterMs: CHECKOUT_POLL.intervalMs },
  },
  {
    name: "past the bound the payment is still being confirmed, and can be checked again",
    from: { ...awaitingGrant, attempts: CHECKOUT_POLL.maxAttempts - 1 },
    event: { type: "acquire_answered", outcome: { status: "payment_required", intent: INTENT } },
    to: stillPending,
    command: null,
  },
  {
    name: "checking again follows the purchase from the start",
    from: stillPending,
    event: { type: "purchase_rechecked" },
    to: awaitingCheckout,
    command: { kind: "read_checkout", checkoutId: "c1" },
  },
  {
    name: "checking again does nothing for a failure that is not a pending payment",
    from: { step: "failed", reason: "install_failed", message: "boom" },
    event: { type: "purchase_rechecked" },
    to: { step: "failed", reason: "install_failed", message: "boom" },
    command: null,
  },
  {
    name: "a refusal after paying fails with its reason",
    from: awaitingGrant,
    event: {
      type: "acquire_answered",
      outcome: { status: "refused", reason: "entitlement_revoked", message: "ended" },
    },
    to: { step: "failed", reason: "entitlement_revoked", message: "ended" },
    command: null,
  },
  // install
  {
    name: "the engine accepting the build follows its progress under the key",
    from: installRequested,
    event: { type: "install_answered", outcome: { status: "installed", moduleKey: KEY } },
    to: installAccepted,
    command: null,
  },
  {
    name: "a build asking for more re-asks for just that, widening the approval",
    from: installRequested,
    event: {
      type: "install_answered",
      outcome: { status: "needs_approval", unapproved: ["twitch.channel"], unapprovedLocalEndpoints: ["obs"] },
    },
    to: {
      step: "consenting",
      approval: { ...APPROVAL, permissions: ["obs.control", "twitch.channel"], localEndpoints: ["obs"] },
      prompt: { permissions: ["twitch.channel"], localEndpoints: [OBS] },
    },
    command: null,
  },
  {
    name: "a build reaching a device the streamer cannot be shown fails instead of asking blind",
    from: installRequested,
    event: {
      type: "install_answered",
      outcome: { status: "needs_approval", unapproved: [], unapprovedLocalEndpoints: ["midi"] },
    },
    to: {
      step: "failed",
      reason: "needs_approval",
      message:
        "This module now asks for access you haven't been shown. Reload the page to review it, then install again.",
    },
    command: null,
  },
  {
    name: "the engine's success is installed",
    from: installAccepted,
    event: { type: "install_reported", outcome: { status: "succeeded" } },
    to: { step: "installed", moduleKey: KEY },
    command: null,
  },
  {
    name: "the engine's failure fails with its message",
    from: installAccepted,
    event: { type: "install_reported", outcome: { status: "failed", message: "barkloader said no" } },
    to: { step: "failed", reason: "install_failed", message: "barkloader said no" },
    command: null,
  },
  {
    name: "a report before the engine accepted anything changes nothing",
    from: installRequested,
    event: { type: "install_reported", outcome: { status: "succeeded" } },
    to: installRequested,
    command: null,
  },
  // failures and dismissal
  {
    name: "a command that fails outright fails the flow",
    from: acquiring,
    event: { type: "command_failed", message: "The marketplace is unavailable right now." },
    to: { step: "failed", reason: "install_failed", message: "The marketplace is unavailable right now." },
    command: null,
  },
  {
    name: "a failure for a flow that ended changes nothing",
    from: INSTALL_FLOW_IDLE,
    event: { type: "command_failed", message: "late" },
    to: INSTALL_FLOW_IDLE,
    command: null,
  },
  {
    name: "dismissing a failure returns to idle",
    from: { step: "failed", reason: "install_failed", message: "boom" },
    event: { type: "dismissed" },
    to: INSTALL_FLOW_IDLE,
    command: null,
  },
  {
    name: "dismissing does not abandon a running flow",
    from: acquiring,
    event: { type: "dismissed" },
    to: acquiring,
    command: null,
  },
];

describe("transition", () => {
  for (const { name, from, event, to, command } of cases) {
    test(name, () => {
      expect(transition(from, event)).toEqual({ state: to, command });
    });
  }
});

describe("installFlowBusy", () => {
  const cases: { state: InstallFlowState; busy: boolean }[] = [
    { state: INSTALL_FLOW_IDLE, busy: false },
    { state: consenting, busy: true },
    { state: acquiring, busy: true },
    { state: needsPayment, busy: true },
    { state: awaitingCheckout, busy: true },
    { state: { step: "licensed", listingId: "obs-scenes" }, busy: false },
    { state: installAccepted, busy: true },
    { state: { step: "installed", moduleKey: KEY }, busy: false },
    { state: { step: "failed", reason: "not_found", message: "gone" }, busy: false },
  ];
  for (const { state, busy } of cases) {
    test(`${state.step} is ${busy ? "busy" : "not busy"}`, () => {
      expect(installFlowBusy(state)).toBe(busy);
    });
  }
});
