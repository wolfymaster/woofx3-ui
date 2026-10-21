import { useEffect, useState } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";

// Asks the engine for its release each time the connection comes up, not on
// a timer: the version only changes when the engine restarts on a new image,
// and a restart shows up as a disconnect followed by a reconnect.
export function useEngineVersion(connected: boolean): string | null {
  const { instanceId } = useEngineScope();
  const getEngineInfo = useEngineGateway().status.useEngineInfoRequest();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    setVersion(null);
    if (!instanceId || !connected) {
      return;
    }

    let cancelled = false;
    void getEngineInfo()
      .then((info) => {
        // An engine older than the version field returns an EngineInfo
        // without one, so the type alone does not guarantee a string.
        const reported: unknown = info?.version;
        if (!cancelled) {
          setVersion(typeof reported === "string" && reported.trim() ? reported : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersion(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId, connected, getEngineInfo]);

  return version;
}
