import { Check, Loader2, X, XCircle } from "lucide-react";
import type { ModuleOAuthResult } from "@/hooks/use-module-oauth-return";
import { cn } from "@/lib/utils";

/** How a module integration's OAuth connect went, from `useModuleOAuthReturn`. */
export function ModuleOAuthResultBanner({
  result,
  onDismiss,
  className,
}: {
  result: ModuleOAuthResult;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs",
        result.status !== "error"
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
          : "border-destructive/30 bg-destructive/5 text-destructive",
        className
      )}
    >
      <span className="flex items-center gap-1.5">
        {result.status === "finishing" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : result.status === "connected" ? (
          <Check className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0" />
        )}
        {result.status === "finishing"
          ? `Finishing the ${result.label} connection...`
          : result.status === "connected"
            ? `${result.label} connected successfully.`
            : result.message}
      </span>
      <button type="button" onClick={onDismiss} className="shrink-0">
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}
