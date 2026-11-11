import { describe, expect, test } from "bun:test";
import type { PurchaseCheckoutRead } from "@/engine/types";
import { CHECKOUT_POLL } from "@/lib/checkout-return";
import type { InstallFlowState } from "@/lib/install-flow";
import { createInstallRunner, type InstallRequests, type InstallTimers } from "@/lib/install-runner";

/** Timers that run only when the test moves the clock. */
function fakeTimers(): InstallTimers & { advance: (ms: number) => void; pending: () => number } {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    set: (run, afterMs) => {
      next += 1;
      due.set(next, { at: now + afterMs, run });
      return next;
    },
    clear: (handle) => {
      due.delete(handle as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [handle, timer] of [...due].sort(([, a], [, b]) => a.at - b.at)) {
        if (timer.at <= now) {
          due.delete(handle);
          timer.run();
        }
      }
    },
    pending: () => due.size,
  };
}

/** A request whose answers the test hands out one at a time. */
function deferredReads() {
  const waiting: Array<(read: PurchaseCheckoutRead) => void> = [];
  return {
    read: (_checkoutId: string) => new Promise<PurchaseCheckoutRead>((resolve) => waiting.push(resolve)),
    answer: (read: PurchaseCheckoutRead) => {
      const resolve = waiting.shift();
      if (!resolve) {
        throw new Error("no read is waiting");
      }
      resolve(read);
    },
    waiting: () => waiting.length,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const timers = fakeTimers();
  const reads = deferredReads();
  const states: InstallFlowState[] = [];
  const opened: string[] = [];
  const requests: InstallRequests = {
    acquireForInstall: async () => ({ status: "licensed", licenseKey: "W3X-KEY" }),
    installWithLicense: async () => ({ status: "installed", moduleKey: "m:1:abc" }),
    startPayment: async () => ({ url: "https://pay.example/1", checkoutId: "c1" }),
    readCheckout: reads.read,
  };
  const runner = createInstallRunner({
    requests: () => requests,
    onState: (state) => states.push(state),
    openUrl: () => undefined,
    onCheckoutOpened: (checkoutId) => opened.push(checkoutId),
    errorMessage: (error) => String(error),
    timers,
  });
  return { runner, timers, reads, states, opened };
}

const RETURN = { type: "payment_returned", purchase: { listingId: "obs", checkoutId: "c1" } } as const;
const UNPAID: PurchaseCheckoutRead = { kind: "state", state: "awaiting_payment" };

describe("install runner", () => {
  test("an answer in flight across an unmount and remount still moves the flow", async () => {
    const { runner, reads } = setup();
    runner.dispatch(RETURN);
    runner.stop();
    runner.start();
    reads.answer({ kind: "state", state: "complete" });
    await flush();
    await flush();
    expect(runner.current()).toEqual({ step: "licensed", listingId: "obs" });
  });

  test("unmounting clears the wait, and remounting arms it again", async () => {
    const { runner, reads, timers } = setup();
    runner.dispatch(RETURN);
    reads.answer(UNPAID);
    await flush();
    expect(timers.pending()).toBe(1);
    runner.stop();
    expect(timers.pending()).toBe(0);
    timers.advance(CHECKOUT_POLL.intervalMs);
    expect(reads.waiting()).toBe(0);
    runner.start();
    expect(timers.pending()).toBe(1);
    timers.advance(CHECKOUT_POLL.intervalMs);
    expect(reads.waiting()).toBe(1);
  });

  test("start and stop are idempotent", async () => {
    const { runner, reads, timers } = setup();
    runner.start();
    runner.dispatch(RETURN);
    reads.answer(UNPAID);
    await flush();
    runner.stop();
    runner.stop();
    runner.start();
    runner.start();
    expect(timers.pending()).toBe(1);
  });

  test("an answer that arrives while unmounted is dropped", async () => {
    const { runner, reads } = setup();
    runner.dispatch(RETURN);
    runner.stop();
    reads.answer({ kind: "state", state: "complete" });
    await flush();
    expect(runner.current()).toMatchObject({ step: "finalizing_payment", phase: "checkout" });
  });

  test("a checkout billing does not know for this engine ends the wait without asking again", async () => {
    const { runner, reads, timers } = setup();
    runner.dispatch(RETURN);
    reads.answer({ kind: "not_found" });
    await flush();
    expect(runner.current()).toMatchObject({ step: "failed", reason: "payment_elsewhere" });
    expect(timers.pending()).toBe(0);
  });

  test("the checkout billing opened is reported before the browser leaves", async () => {
    const { runner, opened } = setup();
    runner.dispatch({
      type: "install_requested",
      approval: {
        listingId: "obs",
        moduleName: "OBS",
        mode: "install",
        permissions: [],
        localEndpoints: [],
        canPay: true,
        knownLocalEndpoints: [],
      },
      prompt: null,
    });
    runner.dispatch({
      type: "acquire_answered",
      outcome: {
        status: "payment_required",
        intent: { id: "pi_1", amountCents: 900, currency: "usd", kind: "full", expiresAt: "2026-11-11T12:00:00Z" },
      },
    });
    await flush();
    expect(opened).toEqual(["c1"]);
  });
});
