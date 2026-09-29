import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { useInstance } from "@/hooks/use-instance";

// Asks the engine for its release each time the connection comes up, not on
// a timer: the version only changes when the engine restarts on a new image,
// and a restart shows up as a disconnect followed by a reconnect.
export function useEngineVersion(connected: boolean): string | null {
  const { instance } = useInstance();
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  const [version, setVersion] = useState<string | null>(null);
  const instanceId = instance?._id;

  useEffect(() => {
    setVersion(null);
    if (!instanceId || !connected) {
      return;
    }

    let cancelled = false;
    void getEngineInfo({ instanceId })
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
