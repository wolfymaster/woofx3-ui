import { describe, expect, test } from "bun:test";
import type { MarketplacePurchaseIntent } from "@/engine/types";
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
const finalizing: InstallFlowState = { step: "finalizing_payment", listingId: "obs-scenes" };
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
    event: { type: "payment_answered", outcome: { status: "redirect", url: "https://pay.example/s/1" } },
    to: needsPayment,
    command: { kind: "open_checkout", url: "https://pay.example/s/1" },
  },
  {
    name: "nothing owed after all acquires again",
    from: needsPayment,
    event: { type: "payment_answered", outcome: { status: "settled" } },
    to: acquiring,
    command: acquireCommand,
  },
  {
    name: "a payment that cannot start fails",
    from: needsPayment,
    event: { type: "payment_answered", outcome: { status: "unavailable", message: "no purchases here" } },
    to: { step: "failed", reason: "payment_unavailable", message: "no purchases here" },
    command: null,
  },
  // payment return
  {
    name: "back from paying, the purchase is confirmed by acquiring again",
    from: INSTALL_FLOW_IDLE,
    event: { type: "payment_returned", listingId: "obs-scenes" },
    to: finalizing,
    command: acquireCommand,
  },
  {
    name: "a confirmed purchase is held and waits for the streamer to install it",
    from: finalizing,
    event: { type: "acquire_answered", outcome: { status: "licensed", licenseKey: "W3X-KEY" } },
    to: { step: "licensed", listingId: "obs-scenes" },
    command: null,
  },
  {
    name: "a purchase the marketplace does not show yet is still pending, and nothing is charged again",
    from: finalizing,
    event: { type: "acquire_answered", outcome: { status: "payment_required", intent: INTENT } },
    to: {
      step: "failed",
      reason: "payment_pending",
      message: "Your purchase is still being confirmed. Reload the page in a moment, then install it.",
    },
    command: null,
  },
  {
    name: "a refusal after paying fails with its reason",
    from: finalizing,
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
    { state: finalizing, busy: true },
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
