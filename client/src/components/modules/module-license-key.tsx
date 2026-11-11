import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useModuleLicenseKeyRequest } from "@/engine/hooks/use-modules";
import { useViewerRole } from "@/engine/hooks/use-viewer-role";
import type { ModuleLicenseLookup } from "@/engine/types";
import { actionErrorMessage } from "@/lib/action-error";
import { useLogger } from "@/lib/logger-context";
import { canSeeLicenseKey } from "@/lib/marketplace-access";

const COPIED_LABEL_MS = 2_000;
const MASK = "••••-••••-••••-••••";
const COPY_LABELS = { idle: "Copy", copied: "Copied", failed: "Couldn't copy" } as const;

/**
 * The license key a marketplace module is held with, masked until asked for:
 * the key downloads the module. Shows nothing when there is no key, and
 * nothing when it cannot be read, since the page works without it. Only
 * owners and admins see it: for anyone else the key is never even requested,
 * which is why the lookup lives in a component that mounts only for them.
 */
export function ModuleLicenseKey(lookup: ModuleLicenseLookup) {
  return canSeeLicenseKey(useViewerRole()) ? <LicenseKeyPanel {...lookup} /> : null;
}

function LicenseKeyPanel({ moduleId, listingId }: ModuleLicenseLookup) {
  const getLicenseKey = useModuleLicenseKeyRequest();
  const logger = useLogger();
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copyState, setCopyState] = useState<keyof typeof COPY_LABELS>("idle");

  useEffect(() => {
    let cancelled = false;
    setLicenseKey(null);
    setShown(false);
    getLicenseKey({ moduleId, listingId })
      .then((key) => {
        if (!cancelled) {
          setLicenseKey(key);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logger.warn("Could not read a module's license key", {
            moduleId,
            listingId,
            error: actionErrorMessage(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getLicenseKey, logger, moduleId, listingId]);

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = setTimeout(() => setCopyState("idle"), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  if (licenseKey === null) {
    return null;
  }

  function copy(key: string) {
    navigator.clipboard.writeText(key).then(
      () => setCopyState("copied"),
      () => setCopyState("failed")
    );
  }

  return (
    <div className="space-y-1.5" data-testid="module-license-key">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">License key</div>
      <code className="block break-all rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">
        {shown ? licenseKey : MASK}
      </code>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setShown(!shown)}>
          {shown ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
          {shown ? "Hide" : "Show"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => copy(licenseKey)}>
          {copyState === "copied" ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {COPY_LABELS[copyState]}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Proof that this module is yours. Keep it private.</p>
    </div>
  );
}
