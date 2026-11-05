import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const COPIED_LABEL_MS = 2_000;
const MASK = "••••••••••••";

/** Only the host stays readable: everything after it can be the credential. */
function maskedUrl(url: string): string {
  try {
    return `${new URL(url).origin}/${MASK}`;
  } catch {
    return MASK;
  }
}

/** The overlay's link, masked until asked for: anyone holding it can open the overlay. */
export function OverlayLink({ url }: { url: string }) {
  const [shown, setShown] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = setTimeout(() => setCopyState("idle"), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  function copy() {
    navigator.clipboard.writeText(url).then(
      () => setCopyState("copied"),
      () => setCopyState("failed")
    );
  }

  return (
    <div className="space-y-2">
      <code
        className="block break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs"
        data-testid="text-overlay-url"
      >
        {shown ? url : maskedUrl(url)}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy} data-testid="button-overlay-copy">
          {copyState === "copied" ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy" : "Copy link"}
        </Button>
        <Button variant="outline" onClick={() => setShown(!shown)} data-testid="button-overlay-show">
          {shown ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
          {shown ? "Hide" : "Show"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Treat this link like a password: anyone who has it can open your overlay. Keep it off screen while you&apos;re
        live.
      </p>
    </div>
  );
}
