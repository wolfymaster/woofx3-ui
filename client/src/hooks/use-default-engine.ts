import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { useConvexUser } from "@/hooks/use-convex-auth";
import { useInstance } from "@/hooks/use-instance";

const APPLIED_KEY_PREFIX = "woofx3:default-engine-applied:";

/**
 * Opens the user's default engine once per browser session, so a later switch
 * (or a reload) keeps the engine they chose. With one engine there is nothing
 * to choose, and with no default the engine used last stays selected.
 */
export function useDefaultEngineOnSignIn() {
  const { user } = useConvexUser();
  const settings = useQuery(api.userSettings.getMine);
  const { instances, setInstance, isLoading } = useInstance();

  useEffect(() => {
    if (!user || settings === undefined || settings === null || isLoading) {
      return;
    }
    const key = `${APPLIED_KEY_PREFIX}${user._id}`;
    if (sessionStorage.getItem(key)) {
      return;
    }
    sessionStorage.setItem(key, "1");
    const target = settings.defaultInstanceId;
    if (target && instances.some((engine) => engine?._id === target)) {
      setInstance(target);
    }
  }, [user, settings, isLoading, instances, setInstance]);
}
