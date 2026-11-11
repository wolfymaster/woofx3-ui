import type { LocalEndpointSummary } from "@shared/local-endpoints";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionApprovalMode } from "@/components/modules/module-permissions";
import { useEngineScope } from "@/engine/context";
import { useTransientEvent } from "@/engine/hooks/use-correlated-request";
import { useEngineCapability } from "@/engine/hooks/use-engine-capabilities";
import {
  useMarketplaceAcquireForInstallRequest,
  useMarketplacePurchaseCheckoutRequest,
  useMarketplacePurchaseCheckoutStateRequest,
} from "@/engine/hooks/use-marketplace";
import { useLicensedInstallRequest, useMarketplaceInstallRequest } from "@/engine/hooks/use-modules";
import { useOrganizationAccess } from "@/engine/hooks/use-organization-access";
import { actionErrorMessage } from "@/lib/action-error";
import {
  INSTALL_FLOW_IDLE,
  type InstallFlowState,
  type InstallFlowStep,
  installFlowBusy,
  type PendingPurchase,
} from "@/lib/install-flow";
import { createInstallRunner } from "@/lib/install-runner";
import { canStartPayment } from "@/lib/marketplace-access";
import { localEndpointsToApprove, permissionsToApprove } from "@/lib/module-permissions";
import { browserPurchaseEngineStorage, rememberPurchaseEngine } from "@/lib/purchase-engines";

// Installing a marketplace module from the browser.
//
// Extracted from pages/modules.tsx so the marketplace storefront installs
// through exactly the same path rather than a second copy of it. The flow has
// several parts that have to stay together to be correct -- the approval
// gate, the engine's progress events, and the timeout -- and two
// implementations of that would drift.
//
// An engine with the `marketplace.licenseKeys` capability installs with a
// license: the account acquires the listing (paying first when it costs
// money, through billing's checkout for the purchase intent) and the engine
// downloads it with the key. Any other engine installs by listing id alone.

/** How long to wait for the engine before calling an install failed. */
const INSTALL_TIMEOUT_MS = 60_000;

/** How long the success state is held before the UI moves on. */
const SUCCESS_LINGER_MS = 1500;

const INSTALL_TIMEOUT_MESSAGE = "Installation timed out. The engine did not respond within 60 seconds.";

/** What the shown and the latest version of a module ask for. */
export interface ModulePermissionSets {
  /** Permissions the installed version declares; null when unreadable. */
  permissions?: string[] | null;
  /** Permissions the marketplace's latest version declares. */
  latestPermissions?: string[] | null;
  /** Local endpoints the installed version declares; null when unreadable. */
  localEndpoints?: LocalEndpointSummary[] | null;
  /** Local endpoints the marketplace's latest version declares. */
  latestLocalEndpoints?: LocalEndpointSummary[] | null;
}

export interface InstallRequest {
  /** The marketplace id to install. Installing and updating are the same call. */
  marketplaceId: string;
  mode: PermissionApprovalMode;
  /** Named in the approval dialog. */
  moduleName: string;
  permissionSets: ModulePermissionSets;
}

/** Props for `<ApproveModulePermissionsDialog>`, ready to spread. */
export interface ApprovalDialogProps {
  open: boolean;
  mode: PermissionApprovalMode;
  moduleName: string;
  permissions: string[];
  localEndpoints: LocalEndpointSummary[];
  onApprove: () => void;
  onCancel: () => void;
}

/** The licensed install's own controls, for a page that pays as well as installs. */
export interface LicensedInstallFlow {
  step: InstallFlowStep;
  /** The browser came back from paying: follow the purchase until it can be installed. */
  confirmPurchase: (purchase: PendingPurchase) => void;
  /** Set while a payment is still being confirmed past the wait: asks about it again. */
  recheckPurchase: (() => void) | null;
}

export interface ModuleInstall {
  isInstalling: boolean;
  error: string | null;
  dismissError: () => void;
  /** The engine's own progress line while installing. */
  progressMessage: string | null;
  succeeded: boolean;
  /** Set while an install is in flight; `{manifestId}:{version}:{sha7}`. */
  pendingModuleKey: string | null;
  /** Starts an install or update, asking for approval first when needed. */
  request: (request: InstallRequest) => void;
  approvalDialogProps: ApprovalDialogProps;
  /**
   * Null on an engine without license keys. Otherwise buying a module also
   * starts with `request`: the streamer approves first, then pays.
   */
  licensed: LicensedInstallFlow | null;
}

/** What one install request sends and asks the streamer for. */
interface Consent {
  /** Sent with the install: everything the module may hold if it succeeds. */
  approved: string[];
  approvedLocalEndpoints: string[];
  /** Shown to the streamer: what this install or update newly allows. */
  toApprove: string[];
  /** Shown with it: devices on their network the module newly reaches. */
  endpointsToApprove: LocalEndpointSummary[];
  /** The endpoints the build to install declares, when they could be read. */
  nextEndpoints: LocalEndpointSummary[];
}

/**
 * Permissions that could not be read are approved as "none new": the install
 * reads the build itself and refuses one declaring anything outside the
 * approved list, so an unreadable listing can never install a permission the
 * streamer did not see.
 */
function consentFor({ mode, permissionSets }: InstallRequest): Consent {
  // `undefined` and `null` both mean "could not be read" to the callers; the
  // approval helpers take only null, so they are collapsed here once rather
  // than at each use below.
  const installed = (mode === "update" ? permissionSets.permissions : null) ?? null;
  const next = mode === "update" ? permissionSets.latestPermissions : permissionSets.permissions;
  const installedEndpoints = (mode === "update" ? permissionSets.localEndpoints : null) ?? null;
  const installedEndpointIds = (installedEndpoints ?? []).map((endpoint) => endpoint.id);

  if (next === null || next === undefined) {
    return {
      approved: installed ?? [],
      approvedLocalEndpoints: installedEndpointIds,
      toApprove: [],
      endpointsToApprove: [],
      nextEndpoints: installedEndpoints ?? [],
    };
  }
  const nextEndpoints = mode === "update" ? permissionSets.latestLocalEndpoints : permissionSets.localEndpoints;
  return {
    approved: next,
    approvedLocalEndpoints: nextEndpoints ? nextEndpoints.map((endpoint) => endpoint.id) : installedEndpointIds,
    toApprove: permissionsToApprove(next, installed),
    endpointsToApprove: nextEndpoints ? localEndpointsToApprove(nextEndpoints, installedEndpoints) : [],
    nextEndpoints: nextEndpoints ?? installedEndpoints ?? [],
  };
}

function needsPrompt(consent: Consent): boolean {
  return consent.toApprove.length > 0 || consent.endpointsToApprove.length > 0;
}

type InstallReport = { status: "succeeded" } | { status: "failed"; message: string };

/**
 * Follows the engine's report for `moduleKey` while it is set. The engine
 * reports progress through transient events keyed by the module key, so the
 * install is watched rather than awaited. Transient events expire, so an
 * engine that never answers times out instead of spinning forever. A success
 * is reported after a short linger, so the success state is seen.
 */
function useInstallReport(moduleKey: string | null, onReport: (report: InstallReport) => void) {
  const installEvent = useTransientEvent(moduleKey);
  // Read through a ref so a caller's new callback on every render does not
  // restart the linger or the timeout.
  const report = useRef(onReport);
  report.current = onReport;

  useEffect(() => {
    if (installEvent?.status === "success") {
      const timer = setTimeout(() => report.current({ status: "succeeded" }), SUCCESS_LINGER_MS);
      return () => clearTimeout(timer);
    }
    if (installEvent?.status === "error") {
      report.current({
        status: "failed",
        message: installEvent.message || "Module installation failed on the engine.",
      });
    }
  }, [installEvent]);

  useEffect(() => {
    if (!moduleKey) {
      return;
    }
    const timer = setTimeout(
      () => report.current({ status: "failed", message: INSTALL_TIMEOUT_MESSAGE }),
      INSTALL_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [moduleKey]);

  return installEvent;
}

/**
 * Drives one module install at a time for the scope's instance.
 *
 * `onInstalled` fires once the engine reports success, for callers that need
 * to refetch a detail view the install has made stale. `onPurchaseConfirmed`
 * fires when a purchase the browser came back from is held, for callers that
 * show what the account owns.
 */
export function useModuleInstall(
  onInstalled?: (moduleKey: string) => void,
  onPurchaseConfirmed?: () => void
): ModuleInstall {
  const licenseKeys = useEngineCapability(ENGINE_CAPABILITIES.marketplaceLicenseKeys);
  const licensed = useLicensedModuleInstall(onInstalled, onPurchaseConfirmed);
  const unlicensed = useUnlicensedModuleInstall(onInstalled);
  return licenseKeys ? licensed : unlicensed;
}

/** The install on an engine with license keys: the state machine in `@/lib/install-flow`. */
function useLicensedModuleInstall(
  onInstalled?: (moduleKey: string) => void,
  onPurchaseConfirmed?: () => void
): ModuleInstall {
  const acquireForInstall = useMarketplaceAcquireForInstallRequest();
  const installWithLicense = useLicensedInstallRequest();
  const startPayment = useMarketplacePurchaseCheckoutRequest();
  const readCheckout = useMarketplacePurchaseCheckoutStateRequest();
  const canPay = canStartPayment(useOrganizationAccess());
  const [state, setState] = useState<InstallFlowState>(INSTALL_FLOW_IDLE);
  const commands = useRef({ acquireForInstall, installWithLicense, startPayment, readCheckout });
  commands.current = { acquireForInstall, installWithLicense, startPayment, readCheckout };

  const { instanceId } = useEngineScope();
  const scopeInstance = useRef(instanceId);
  scopeInstance.current = instanceId;

  const [runner] = useState(() =>
    createInstallRunner({
      requests: () => commands.current,
      onState: setState,
      openUrl: (url) => window.location.assign(url),
      onCheckoutOpened: (checkoutId) => {
        if (scopeInstance.current !== null) {
          rememberPurchaseEngine(browserPurchaseEngineStorage(), checkoutId, scopeInstance.current, Date.now());
        }
      },
      errorMessage: actionErrorMessage,
      timers: {
        set: (run, afterMs) => setTimeout(run, afterMs),
        clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    })
  );
  const { dispatch } = runner;
  useEffect(() => {
    runner.start();
    return runner.stop;
  }, [runner]);

  const pendingModuleKey = state.step === "installing" ? state.moduleKey : null;
  const onReport = (report: InstallReport) => {
    const current = runner.current();
    dispatch({ type: "install_reported", outcome: report });
    if (report.status === "succeeded" && current.step === "installing" && current.moduleKey !== null) {
      onInstalled?.(current.moduleKey);
    }
  };
  const installEvent = useInstallReport(pendingModuleKey, onReport);

  // Once per arrival at `licensed`: the caller's callback is often a new
  // function on every render, and refetching re-renders.
  const purchaseConfirmed = useRef(onPurchaseConfirmed);
  purchaseConfirmed.current = onPurchaseConfirmed;
  useEffect(() => {
    if (state.step === "licensed") {
      purchaseConfirmed.current?.();
    }
  }, [state.step]);

  const request = useCallback(
    (request: InstallRequest) => {
      const consent = consentFor(request);
      dispatch({
        type: "install_requested",
        approval: {
          listingId: request.marketplaceId,
          moduleName: request.moduleName,
          mode: request.mode,
          permissions: consent.approved,
          localEndpoints: consent.approvedLocalEndpoints,
          canPay,
          knownLocalEndpoints: consent.nextEndpoints,
        },
        prompt: needsPrompt(consent)
          ? { permissions: consent.toApprove, localEndpoints: consent.endpointsToApprove }
          : null,
      });
    },
    [dispatch, canPay]
  );

  const confirmPurchase = useCallback(
    (purchase: PendingPurchase) => dispatch({ type: "payment_returned", purchase }),
    [dispatch]
  );
  const recheck = useCallback(() => dispatch({ type: "purchase_rechecked" }), [dispatch]);
  const recheckPurchase = state.step === "failed" && state.purchase !== undefined ? recheck : null;
  const dismissError = useCallback(() => {
    if (runner.current().step === "failed") {
      dispatch({ type: "dismissed" });
    }
  }, [runner, dispatch]);

  const consenting = state.step === "consenting" ? state : null;
  return {
    isInstalling: installFlowBusy(state) && state.step !== "consenting",
    error: state.step === "failed" ? state.message : null,
    dismissError,
    progressMessage: pendingModuleKey !== null ? (installEvent?.message ?? null) : null,
    succeeded: installEvent?.status === "success",
    pendingModuleKey,
    request,
    approvalDialogProps: {
      open: consenting !== null,
      mode: consenting?.approval.mode ?? "install",
      moduleName: consenting?.approval.moduleName ?? "This module",
      permissions: consenting?.prompt.permissions ?? [],
      localEndpoints: consenting?.prompt.localEndpoints ?? [],
      onApprove: () => dispatch({ type: "consent_given" }),
      onCancel: () => dispatch({ type: "consent_withdrawn" }),
    },
    licensed: { step: state.step, confirmPurchase, recheckPurchase },
  };
}

interface PendingApproval {
  request: InstallRequest;
  consent: Consent;
}

/**
 * The install on an engine without license keys: by listing id, with the
 * approvals, through the Convex `installModule` action.
 *
 * Kept only for engines that do not report the `marketplace.licenseKeys`
 * capability. Delete it, with `installModule`'s Convex download path, once
 * every engine reports that capability; nothing counts that coverage yet, so
 * the deletion waits on it being counted. It must be gone before the
 * marketplace stops serving downloads without a license key, which would
 * break it.
 */
function useUnlicensedModuleInstall(onInstalled?: (moduleKey: string) => void): ModuleInstall {
  const { instanceId } = useEngineScope();
  const installMarketplaceModule = useMarketplaceInstallRequest();
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingModuleKey, setPendingModuleKey] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const onReport = (report: InstallReport) => {
    if (report.status === "failed") {
      setError(report.message);
    }
    setIsInstalling(false);
    setPendingModuleKey(null);
    if (report.status === "succeeded" && pendingModuleKey) {
      onInstalled?.(pendingModuleKey);
    }
  };
  const installEvent = useInstallReport(pendingModuleKey, onReport);

  const run = useCallback(
    async (marketplaceId: string, approvedPermissions: string[], approvedLocalEndpoints: string[]) => {
      if (!instanceId) {
        return;
      }
      setIsInstalling(true);
      setError(null);
      try {
        const { moduleKey } = await installMarketplaceModule(
          marketplaceId,
          approvedPermissions,
          approvedLocalEndpoints
        );
        setPendingModuleKey(moduleKey);
      } catch (err) {
        setError(actionErrorMessage(err));
        setIsInstalling(false);
      }
    },
    [instanceId, installMarketplaceModule]
  );

  const request = useCallback(
    (request: InstallRequest) => {
      const consent = consentFor(request);
      if (!needsPrompt(consent)) {
        void run(request.marketplaceId, consent.approved, consent.approvedLocalEndpoints);
        return;
      }
      setPendingApproval({ request, consent });
    },
    [run]
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    isInstalling,
    error,
    dismissError,
    progressMessage: isInstalling ? (installEvent?.message ?? null) : null,
    succeeded: installEvent?.status === "success",
    pendingModuleKey,
    request,
    approvalDialogProps: {
      open: pendingApproval !== null,
      mode: pendingApproval?.request.mode ?? "install",
      moduleName: pendingApproval?.request.moduleName ?? "This module",
      permissions: pendingApproval?.consent.toApprove ?? [],
      localEndpoints: pendingApproval?.consent.endpointsToApprove ?? [],
      onApprove: () => {
        if (pendingApproval) {
          void run(
            pendingApproval.request.marketplaceId,
            pendingApproval.consent.approved,
            pendingApproval.consent.approvedLocalEndpoints
          );
        }
        setPendingApproval(null);
      },
      onCancel: () => setPendingApproval(null),
    },
    licensed: null,
  };
}
