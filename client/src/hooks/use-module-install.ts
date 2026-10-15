import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LocalEndpointSummary } from "@convex/lib/localEndpoints";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import type { PermissionApprovalMode } from "@/components/modules/module-permissions";
import { localEndpointsToApprove, permissionsToApprove } from "@/lib/module-permissions";

// Installing a marketplace module from the browser.
//
// Extracted from pages/modules.tsx so the marketplace storefront installs
// through exactly the same path rather than a second copy of it. The flow has
// several parts that have to stay together to be correct -- the approval
// gate, the engine's progress events, and the timeout -- and two
// implementations of that would drift.

/** How long to wait for the engine before calling an install failed. */
const INSTALL_TIMEOUT_MS = 60_000;

/** How long the success state is held before the UI moves on. */
const SUCCESS_LINGER_MS = 1500;

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

export interface ModuleInstall {
  isInstalling: boolean;
  error: string | null;
  dismissError: () => void;
  /** The engine's own progress line while installing. */
  progressMessage: string | null;
  succeeded: boolean;
  /** Set while an install is in flight; `{marketplaceId}:{version}:{sha7}`. */
  pendingModuleKey: string | null;
  /** Starts an install or update, asking for approval first when needed. */
  request: (request: InstallRequest) => void;
  approvalDialogProps: ApprovalDialogProps;
}

interface PendingApproval {
  request: InstallRequest;
  /** Shown to the streamer: what this install or update newly allows. */
  toApprove: string[];
  /** Shown with it: devices on their network the module newly reaches. */
  endpointsToApprove: LocalEndpointSummary[];
  /** Sent with the install: everything the module may hold if it succeeds. */
  approved: string[];
  approvedLocalEndpoints: string[];
}

/**
 * Drives one module install at a time for `instanceId`.
 *
 * `onInstalled` fires once the engine reports success, for callers that need
 * to refetch a detail view the install has made stale.
 */
export function useModuleInstall(
  instanceId: Id<"instances"> | undefined,
  onInstalled?: (moduleKey: string) => void
): ModuleInstall {
  const installMarketplaceModule = useAction(api.marketplace.installModule);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingModuleKey, setPendingModuleKey] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  // The engine reports progress through transient events keyed by the module
  // key, so the install is watched rather than awaited: the action returns as
  // soon as the engine accepts the work.
  const installEvent = useQuery(
    api.transientEvents.get,
    instanceId && pendingModuleKey ? { instanceId, correlationKey: pendingModuleKey } : "skip"
  );

  const run = useCallback(
    async (marketplaceId: string, approvedPermissions: string[], approvedLocalEndpoints: string[]) => {
      if (!instanceId) {
        return;
      }
      setIsInstalling(true);
      setError(null);
      try {
        const { moduleKey } = await installMarketplaceModule({
          instanceId,
          marketplaceModuleId: marketplaceId,
          approvedPermissions,
          approvedLocalEndpoints,
        });
        setPendingModuleKey(moduleKey);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to install marketplace module.");
        setIsInstalling(false);
      }
    },
    [instanceId, installMarketplaceModule]
  );

  /**
   * Permissions that could not be read are approved as "none new": the
   * install action reads the archive itself and refuses one declaring
   * anything outside the approved list, so an unreadable listing can never
   * install a permission the streamer did not see.
   */
  const request = useCallback(
    (request: InstallRequest) => {
      const { mode, permissionSets, marketplaceId } = request;
      // `undefined` and `null` both mean "could not be read" to the callers;
      // the approval helpers take only null, so they are collapsed here once
      // rather than at each use below.
      const installed = (mode === "update" ? permissionSets.permissions : null) ?? null;
      const next = mode === "update" ? permissionSets.latestPermissions : permissionSets.permissions;
      const installedEndpoints = (mode === "update" ? permissionSets.localEndpoints : null) ?? null;
      const installedEndpointIds = (installedEndpoints ?? []).map((endpoint) => endpoint.id);

      if (next === null || next === undefined) {
        void run(marketplaceId, installed ?? [], installedEndpointIds);
        return;
      }

      const toApprove = permissionsToApprove(next, installed);
      const nextEndpoints = mode === "update" ? permissionSets.latestLocalEndpoints : permissionSets.localEndpoints;
      const endpointsToApprove = nextEndpoints ? localEndpointsToApprove(nextEndpoints, installedEndpoints) : [];
      const approvedEndpointIds = nextEndpoints ? nextEndpoints.map((endpoint) => endpoint.id) : installedEndpointIds;

      if (toApprove.length === 0 && endpointsToApprove.length === 0) {
        void run(marketplaceId, next, approvedEndpointIds);
        return;
      }
      setPendingApproval({
        request,
        toApprove,
        endpointsToApprove,
        approved: next,
        approvedLocalEndpoints: approvedEndpointIds,
      });
    },
    [run]
  );

  useEffect(() => {
    if (installEvent?.status === "success") {
      const key = pendingModuleKey;
      const timer = setTimeout(() => {
        setIsInstalling(false);
        setPendingModuleKey(null);
        if (key) {
          onInstalled?.(key);
        }
      }, SUCCESS_LINGER_MS);
      return () => clearTimeout(timer);
    }
    if (installEvent?.status === "error") {
      setError(installEvent.message || "Module installation failed on the engine.");
      setIsInstalling(false);
      setPendingModuleKey(null);
    }
  }, [installEvent, pendingModuleKey, onInstalled]);

  // Transient events expire, so an engine that never answers would leave the
  // button spinning forever without this.
  useEffect(() => {
    if (!isInstalling || !pendingModuleKey) {
      return;
    }
    const timer = setTimeout(() => {
      setError("Installation timed out. The engine did not respond within 60 seconds.");
      setIsInstalling(false);
      setPendingModuleKey(null);
    }, INSTALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isInstalling, pendingModuleKey]);

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
      permissions: pendingApproval?.toApprove ?? [],
      localEndpoints: pendingApproval?.endpointsToApprove ?? [],
      onApprove: () => {
        if (pendingApproval) {
          void run(
            pendingApproval.request.marketplaceId,
            pendingApproval.approved,
            pendingApproval.approvedLocalEndpoints
          );
        }
        setPendingApproval(null);
      },
      onCancel: () => setPendingApproval(null),
    },
  };
}
