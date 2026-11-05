import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface RetryButtonProps {
  onRetry: () => Promise<void>;
  label?: string;
  variant?: "default" | "outline";
  testId: string;
}

/** A button for an action that can fail, showing its own progress and failure so the page around it stays simple. */
export function RetryButton({ onRetry, label = "Try again", variant = "default", testId }: RetryButtonProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      await onRetry();
    } catch {
      // The reason is written for operators; the streamer's next move is the same either way.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant={variant} onClick={() => void run()} disabled={busy} data-testid={testId}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {label}
      </Button>
      {failed && <p className="text-sm text-destructive">That didn&apos;t work. Give it a moment and try again.</p>}
    </div>
  );
}
