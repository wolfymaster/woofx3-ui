import { Loader2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useIsInstanceAdmin } from "@/hooks/use-instance-role";

/**
 * Shows instance settings only to the instance's owners and admins. Members
 * get a short explanation instead of the page. The Convex functions behind
 * these pages refuse members too; this keeps members from landing on screens
 * whose every action would fail.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const isAdmin = useIsInstanceAdmin();

  if (isAdmin === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto p-6 py-16 text-center space-y-3" data-testid="admin-only-refusal">
        <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground" />
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="text-sm text-muted-foreground">
          Instance settings can be changed by the account's owner and admins. Ask one of them if something here needs
          changing.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to the dashboard</Link>
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
