import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/lib/action-error";
import { CONFIRM_REFUSALS } from "@/lib/verify-email";

/**
 * Asks for the mailed code and checks it. Renders nothing for a verified
 * address, so a page can include it unconditionally.
 */
export function VerifyEmail({ onVerified }: { onVerified?: () => void }) {
  const status = useQuery(api.emailVerification.status);
  const requestCode = useAction(api.emailVerification.request);
  const confirm = useMutation(api.emailVerification.confirm);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!status || status.verified || status.email === null) {
    return null;
  }

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      await requestCode({});
      setSent(true);
    } catch (error) {
      setMessage(actionErrorMessage(error));
    }
    setBusy(false);
  }

  async function check() {
    setBusy(true);
    setMessage(null);
    try {
      const { status: outcome } = await confirm({ code });
      if (outcome === "verified") {
        onVerified?.();
      } else {
        setMessage(CONFIRM_REFUSALS[outcome]);
      }
    } catch (error) {
      setMessage(actionErrorMessage(error));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2" data-testid="verify-email">
      <p className="text-sm">
        {sent
          ? `We emailed a 6-digit code to ${status.email}. Enter it below.`
          : `Verify ${status.email} to prove it's yours. We'll email you a 6-digit code.`}
      </p>
      {sent ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <Input
            aria-label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-32"
            data-testid="input-verification-code"
          />
          <Button type="submit" disabled={busy || code.length !== 6} data-testid="button-confirm-code">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void send()}>
            Send a new code
          </Button>
        </form>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => void send()} data-testid="button-send-code">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Email me a code"}
        </Button>
      )}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
