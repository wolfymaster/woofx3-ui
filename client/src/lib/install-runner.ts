import type {
  InstallAcquireOutcome,
  LicensedInstall,
  LicensedInstallOutcome,
  PurchaseCheckoutRead,
} from "@/engine/types";
import {
  INSTALL_FLOW_IDLE,
  type InstallCommand,
  type InstallFlowEvent,
  type InstallFlowState,
  installFlowBusy,
  transition,
} from "@/lib/install-flow";

// Runs the install flow's commands and feeds their answers back to
// `transition`. The flow's state lives here, so an answer moves the state it
// was asked from rather than the render it was asked in. A flow the streamer
// left or restarted must not be moved by its own late answers: each flow gets
// a generation, and an answer from an older one is dropped.
//
// The hook owning it may unmount and mount again (React's StrictMode does both
// on every mount), so stopping parks the waits instead of ending the flow, and
// starting again re-arms them. Answers that arrive while stopped are dropped.

/** The requests the commands make; read on every command, so a caller may swap them between renders. */
export interface InstallRequests {
  acquireForInstall: (listingId: string) => Promise<InstallAcquireOutcome>;
  installWithLicense: (install: LicensedInstall) => Promise<LicensedInstallOutcome>;
  startPayment: (intentId: string) => Promise<{ url: string; checkoutId: string }>;
  readCheckout: (checkoutId: string) => Promise<PurchaseCheckoutRead>;
}

export interface InstallTimers {
  set: (run: () => void, afterMs: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface InstallRunnerDeps {
  requests: () => InstallRequests;
  onState: (state: InstallFlowState) => void;
  /** Sends the browser to a payment page. */
  openUrl: (url: string) => void;
  /** Billing opened checkout `checkoutId`, before the browser leaves for it. */
  onCheckoutOpened: (checkoutId: string) => void;
  errorMessage: (error: unknown) => string;
  timers: InstallTimers;
}

export interface InstallRunner {
  dispatch: (event: InstallFlowEvent) => void;
  current: () => InstallFlowState;
  /** Delivers answers and runs waits; idempotent. */
  start: () => void;
  /** Parks the waits and drops answers until `start`; idempotent. */
  stop: () => void;
}

interface Wait {
  flow: number;
  afterMs: number;
  call: () => void;
}

export function createInstallRunner(deps: InstallRunnerDeps): InstallRunner {
  let current: InstallFlowState = INSTALL_FLOW_IDLE;
  let generation = 0;
  let running = true;
  const armed = new Map<unknown, Wait>();
  let parked: Wait[] = [];

  const startsFlow = (event: InstallFlowEvent): boolean =>
    (event.type === "install_requested" || event.type === "payment_returned" || event.type === "purchase_rechecked") &&
    !installFlowBusy(current);

  const dispatch = (event: InstallFlowEvent): void => {
    if (startsFlow(event)) {
      generation += 1;
    }
    const next = transition(current, event);
    current = next.state;
    deps.onState(next.state);
    if (next.command !== null) {
      run(next.command, generation);
    }
  };

  const answer = (flow: number, event: InstallFlowEvent): void => {
    if (running && flow === generation) {
      dispatch(event);
    }
  };

  const arm = (wait: Wait): void => {
    const handle = deps.timers.set(() => {
      armed.delete(handle);
      if (wait.flow === generation) {
        wait.call();
      }
    }, wait.afterMs);
    armed.set(handle, wait);
  };

  const later = (flow: number, afterMs: number | undefined, call: () => void): void => {
    if (afterMs === undefined) {
      call();
      return;
    }
    const wait = { flow, afterMs, call };
    if (running) {
      arm(wait);
    } else {
      parked.push(wait);
    }
  };

  const run = (command: InstallCommand, flow: number): void => {
    const failed = (error: unknown) => answer(flow, { type: "command_failed", message: deps.errorMessage(error) });
    const requests = deps.requests();
    switch (command.kind) {
      case "acquire":
        later(flow, command.afterMs, () => {
          deps
            .requests()
            .acquireForInstall(command.listingId)
            .then((outcome) => answer(flow, { type: "acquire_answered", outcome }), failed);
        });
        return;
      case "read_checkout":
        later(flow, command.afterMs, () => {
          deps
            .requests()
            .readCheckout(command.checkoutId)
            .then(
              (read) =>
                answer(
                  flow,
                  read.kind === "state"
                    ? { type: "checkout_answered", state: read.state }
                    : { type: "checkout_not_found" }
                ),
              failed
            );
        });
        return;
      case "start_payment":
        requests.startPayment(command.intent.id).then(({ url, checkoutId }) => {
          deps.onCheckoutOpened(checkoutId);
          answer(flow, { type: "payment_answered", url });
        }, failed);
        return;
      case "open_checkout":
        deps.openUrl(command.url);
        return;
      case "install":
        requests
          .installWithLicense({
            listingId: command.approval.listingId,
            licenseKey: command.licenseKey,
            approvedPermissions: command.approval.permissions,
            approvedLocalEndpoints: command.approval.localEndpoints,
          })
          .then((outcome) => answer(flow, { type: "install_answered", outcome }), failed);
        return;
    }
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    const waits = parked.filter((wait) => wait.flow === generation);
    parked = [];
    for (const wait of waits) {
      arm(wait);
    }
  };

  const stop = (): void => {
    if (!running) {
      return;
    }
    running = false;
    for (const [handle, wait] of armed) {
      deps.timers.clear(handle);
      parked.push(wait);
    }
    armed.clear();
  };

  return { dispatch, current: () => current, start, stop };
}
