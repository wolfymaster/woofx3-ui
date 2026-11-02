import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";
import { getStoredValue } from "@/lib/stores";
import { onOpenLocalConnections } from "./host";
import { endpointsToSetUp } from "./local-connections";
import { useIntegrationsFor } from "./use-integrations";

/** Must match the Integrations route in App.tsx. */
const LOCAL_CONNECTIONS_PATH = "/admin/integrations";

const DISMISSED_KEY = "woofx3-local-connections-dismissed";

/**
 * Gets people to their local connections: asks once per endpoint nobody has set
 * up, since the relay stays off until one is on and nothing else would say so,
 * and answers the tray's "Local connections" item.
 */
export default function LocalConnectionsGuide() {
  const { instance } = useInstance();
  const view = useIntegrationsFor(instance?._id);
  const [location, navigate] = useLocation();
  const [dismissed, setDismissed] = useState<string[]>(() => getStoredValue<string[]>(DISMISSED_KEY, []));

  useEffect(() => {
    const unlisten = onOpenLocalConnections(() => navigate(LOCAL_CONNECTIONS_PATH));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [navigate]);

  const toSetUp = view ? endpointsToSetUp(view, new Set(dismissed)) : [];
  if (toSetUp.length === 0 || location === LOCAL_CONNECTIONS_PATH) {
    return null;
  }

  const dismiss = () => {
    const next = [...dismissed, ...toSetUp.map(({ key }) => key)];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };
  const names = toSetUp.map(({ name }) => name).join(", ");

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
      data-testid="local-connections-guide"
    >
      <button
        type="button"
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-6 text-sm font-medium">Connect {names}?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Your engine can't reach it until it's set up on this computer.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not now
        </Button>
        <Button
          size="sm"
          onClick={() => navigate(LOCAL_CONNECTIONS_PATH)}
          data-testid="button-set-up-local-connections"
        >
          Set up
        </Button>
      </div>
    </div>
  );
}
