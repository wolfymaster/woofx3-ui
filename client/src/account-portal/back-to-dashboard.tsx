import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/**
 * The way out of the portal to the dashboard. A viewer with no engine has no dashboard: `/` would send them
 * straight back to their account, so the link is not offered.
 */
export function BackToDashboard({ hasEngine }: { hasEngine: boolean }) {
  if (!hasEngine) {
    return null;
  }
  return (
    <Button variant="outline" size="sm" asChild data-testid="link-back-to-dashboard">
      <Link href="/">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to dashboard
      </Link>
    </Button>
  );
}
