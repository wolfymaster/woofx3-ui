import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UpdateRestartButton } from "./UpdateRestartButton";
import { useReadyUpdate } from "./use-ready-update";

/**
 * Offers a ready update. The app never restarts on its own, so this, the
 * header's update icon and the tray's item are the ways in. Dismissing hides
 * only this card, for that version; the icon stays until the app restarts.
 */
export default function UpdateBanner() {
  const update = useReadyUpdate();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (!update || update.version === dismissedVersion) {
    return null;
  }

  // Leaves the way it came in, to the right, then unmounts.
  const dismiss = () => setLeaving(true);
  const finishLeaving = () => {
    if (leaving) {
      setDismissedVersion(update.version);
      setLeaving(false);
    }
  };

  return (
    <div
      className={
        "fixed right-4 top-[4.25rem] z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card/90 p-4 pr-10 " +
        "text-card-foreground shadow-lg backdrop-blur-xl transition duration-200 ease-out " +
        "animate-in fade-in slide-in-from-right-4 motion-reduce:animate-none motion-reduce:slide-in-from-right-0 " +
        (leaving ? "translate-x-4 opacity-0 motion-reduce:translate-x-0" : "")
      }
      aria-live="polite"
      data-testid="update-banner"
      onTransitionEnd={finishLeaving}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-7 w-7 text-muted-foreground"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        data-testid="button-dismiss-update"
      >
        <X className="h-4 w-4" />
      </Button>
      <p className="text-sm font-medium">
        {update.productName} {update.version} is ready
      </p>
      <UpdateRestartButton />
    </div>
  );
}
