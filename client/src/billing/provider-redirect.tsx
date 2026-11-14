import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";

/**
 * Sends the browser to a provider page: checkout, the customer portal, or a
 * payment-method setup session. `open` answers null when there is nothing to
 * open, and the button stays put.
 */
export function useProviderRedirect() {
  const [busy, setBusy] = useState(false);
  async function go(open: () => Promise<{ url: string } | null>) {
    setBusy(true);
    try {
      const target = await open();
      if (target === null) {
        setBusy(false);
        return;
      }
      window.location.assign(target.url);
    } catch (error) {
      toast({ title: "Billing is unavailable", description: actionErrorMessage(error), variant: "destructive" });
      setBusy(false);
    }
  }
  return { busy, go };
}

interface ProviderRedirectButtonProps {
  label: string;
  open: () => Promise<{ url: string } | null>;
  testId?: string;
}

/** A button that hands the browser to the payment provider. */
export function ProviderRedirectButton({ label, open, testId }: ProviderRedirectButtonProps) {
  const { busy, go } = useProviderRedirect();
  return (
    <Button variant="outline" disabled={busy} onClick={() => go(open)} data-testid={testId}>
      {label}
      <ExternalLink className="h-4 w-4 ml-2" />
    </Button>
  );
}
