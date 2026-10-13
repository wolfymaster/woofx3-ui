import type { EntitlementFeatureKey } from "@convex/lib/entitlements";
import { Loader2, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEntitlement } from "@/hooks/use-entitlements";

interface PlanGateProps {
  entitlement: EntitlementFeatureKey;
  /** What the gated section does, in a phrase: "Advanced reports". */
  feature: string;
  children: ReactNode;
}

/**
 * Renders `children` only when the account's plan includes the entitlement,
 * and otherwise says it is not on the plan. The Convex functions behind the
 * feature check the same entitlement; this only spares the viewer a refusal.
 * For an engine feature, nest an EngineFeatureGate inside it.
 */
export function PlanGate({ entitlement, feature, children }: PlanGateProps) {
  const entitled = useEntitlement(entitlement);
  if (entitled === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (entitled) {
    return <>{children}</>;
  }
  return (
    <Alert data-testid="plan-gate-not-included">
      <Lock className="h-4 w-4" />
      <AlertTitle>Not included in your plan</AlertTitle>
      <AlertDescription>{feature} isn't included in this account's plan.</AlertDescription>
    </Alert>
  );
}
