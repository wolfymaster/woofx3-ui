import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLogger } from "@/lib/logger-context";
import { appState, installUpdate, onAppStateChange, type ReadyUpdate } from "./host";

/** Follows the update the host has downloaded and verified, if any. */
function useReadyUpdate(): ReadyUpdate | null {
  const logger = useLogger();
  const [update, setUpdate] = useState<ReadyUpdate | null>(null);
  useEffect(() => {
    let disposed = false;
    let eventSeen = false;
    // Subscribe before reading, so a change between the two is not lost.
    const unlisten = onAppStateChange((state) => {
      eventSeen = true;
      setUpdate(state.update);
    });
    appState().then(
      (state) => {
        if (!disposed && !eventSeen) {
          setUpdate(state.update);
        }
      },
      (err: unknown) => {
        logger.error("Couldn't read the app's update state from the host", { error: err });
      }
    );
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, [logger]);
  return update;
}

/**
 * Offers a ready update. The app never restarts on its own, so this and the
 * tray's item are the ways in. A failed install leaves the update ready and
 * says why here.
 */
export default function UpdateBanner() {
  const logger = useLogger();
  const update = useReadyUpdate();
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!update) {
    return null;
  }

  const install = async () => {
    setInstalling(true);
    setFailure(null);
    try {
      await installUpdate();
    } catch (err) {
      logger.error("Couldn't install the update", { error: err });
      setFailure(typeof err === "string" ? err : "The update couldn't be installed. Try again.");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      className="fixed bottom-4 left-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
      aria-live="polite"
      data-testid="update-banner"
    >
      <p className="text-sm font-medium">
        {update.productName} {update.version} is ready
      </p>
      {failure && <p className="mt-1 text-sm text-destructive">{failure}</p>}
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => void install()} disabled={installing} data-testid="button-restart-to-update">
          {installing ? "Restarting…" : "Restart to update"}
        </Button>
      </div>
    </div>
  );
}
