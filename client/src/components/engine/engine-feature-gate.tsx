import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CapabilitySupport, EngineCapabilitiesState } from "@/lib/engine-capabilities";

interface EngineFeatureGateProps {
  support: CapabilitySupport;
  state: EngineCapabilitiesState;
  /** What the gated section does, in a phrase: "Backups", "Supporter stats". */
  feature: string;
  onRetry: () => void;
  children: ReactNode;
}

/**
 * Renders `children` only when the engine supports the feature, and otherwise
 * says why not: an engine too old for it, or one that could not be asked.
 */
export function EngineFeatureGate({ support, state, feature, onRetry, children }: EngineFeatureGateProps) {
  if (support === "supported") {
    return <>{children}</>;
  }
  if (support === "checking") {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (support === "unsupported") {
    return (
      <Alert data-testid="engine-feature-needs-update">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Update your engine</AlertTitle>
        <AlertDescription>
          {feature} needs a newer engine than the one this instance runs. Update it to the latest release; this page
          checks again when the engine reconnects.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert data-testid="engine-feature-unknown">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Couldn't check your engine</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {feature} depends on what your engine supports, and it didn't answer.
          {state.status === "error" && ` ${state.message}`}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-engine-feature-retry">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
