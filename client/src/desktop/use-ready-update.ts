import { useEffect, useState } from "react";
import { useLogger } from "@/lib/logger-context";
import { appState, installUpdate, onAppStateChange, type ReadyUpdate } from "./host";

/** Follows the update the host has downloaded and verified, if any. */
export function useReadyUpdate(): ReadyUpdate | null {
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

/** Installs the ready update; a failed install leaves it ready and keeps the reason in `failure`. */
export function useInstallUpdate() {
  const logger = useLogger();
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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

  return { install, installing, failure };
}
