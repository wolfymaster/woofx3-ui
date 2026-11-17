import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useInstallUpdate, useReadyUpdate } from "./use-ready-update";

/**
 * A thin full-width bar above the header offering a ready update. The app
 * never restarts on its own, so this, the header's update icon and the tray's
 * item are the ways in. Closing hides only this bar, for that version; the
 * icon stays until the app restarts.
 */
export default function UpdateBanner() {
  const update = useReadyUpdate();
  const { install, installing, failure } = useInstallUpdate();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  if (!update || update.version === dismissedVersion) {
    return null;
  }

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-3 bg-primary px-4 text-sm text-primary-foreground"
      role="status"
      aria-live="polite"
      data-testid="update-banner"
    >
      <p className="min-w-0 flex-1 truncate text-center">
        {failure ?? `A new version of ${update.productName} is available (${update.version}).`}
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="h-6 shrink-0 px-2.5 text-xs"
        onClick={() => void install()}
        disabled={installing}
        data-testid="button-restart-to-update"
      >
        {installing ? "Restarting…" : "Update Now"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 hover:bg-primary-foreground/15 hover:text-primary-foreground"
        onClick={() => setDismissedVersion(update.version)}
        aria-label="Close update notice"
        data-testid="button-dismiss-update"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
