import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SetupModuleInstall, SetupStatus } from "@convex/setup";
import { useMutation, useQuery } from "convex/react";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";
import { describePermissions } from "@/lib/module-permissions";

/**
 * A strip under the shell header when a platform the app depends on, chosen at
 * setup, did not install: it failed, or its current build asks for permissions
 * nobody approved. It blocks nothing else. Optional platforms that did not
 * install are left to the setup summary.
 */
export function SetupInstallBanner() {
  const { instance } = useInstance();
  const status = useQuery(api.setup.status, instance ? { instanceId: instance._id } : "skip");
  if (!instance || !status) {
    return null;
  }
  const required = new Set(status.requiredModuleIds);
  const problem = status.moduleInstalls.find(
    (install) => required.has(install.marketplaceModuleId) && install.status !== "installed"
  );
  if (!problem) {
    return null;
  }
  return <ProblemStrip instanceId={instance._id} status={status} install={problem} />;
}

function ProblemStrip({
  instanceId,
  status,
  install,
}: {
  instanceId: Id<"instances">;
  status: SetupStatus;
  install: SetupModuleInstall;
}) {
  const retryApply = useMutation(api.setup.retryApply);
  const approve = useMutation(api.setup.approveModulePermissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = status.platforms.find((entry) => entry.marketplaceModuleId === install.marketplaceModuleId);
  const name = platform?.name ?? install.marketplaceModuleId;
  const needsApproval = install.status === "needs_approval";
  const unapproved = [
    ...describePermissions(install.unapproved ?? []).map((permission) => permission.description.toLowerCase()),
    ...(install.unapprovedLocalEndpoints ?? []).map((id) => `connect to "${id}" on your network`),
  ];

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const handleAction = () =>
    run(() =>
      needsApproval
        ? approve({
            instanceId,
            marketplaceModuleId: install.marketplaceModuleId,
            approvedPermissions: [...(platform?.approvedPermissions ?? []), ...(install.unapproved ?? [])],
            approvedLocalEndpoints: [
              ...(platform?.approvedLocalEndpoints ?? []),
              ...(install.unapprovedLocalEndpoints ?? []),
            ],
          })
        : retryApply({ instanceId })
    );

  return (
    <div
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm shrink-0"
      data-testid="banner-setup-install"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1">
        {needsApproval ? (
          <>
            {name} was not installed: its latest version also asks to {unapproved.join("; ")}.
          </>
        ) : (
          <>
            Installing {name} failed{install.error ? `: ${install.error}` : "."}
          </>
        )}
        {error && <span className="block text-destructive">{error}</span>}
      </p>
      {status.canManageSetup ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0"
          onClick={() => void handleAction()}
          disabled={busy}
          data-testid="button-banner-setup-install"
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {needsApproval ? "Allow and install" : "Retry"}
        </Button>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">Ask an owner or admin to fix this.</span>
      )}
    </div>
  );
}
