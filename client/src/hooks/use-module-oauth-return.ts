import { oauthErrorMessage } from "@convex/lib/oauthErrors";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useModuleOAuthFinishRequest } from "@/engine/hooks/use-module-oauth";

/**
 * A connect of a module's `oauth[]` integration (moduleOAuth.ts) the OAuth
 * callback sent the browser back with. `label` names the provider to the
 * streamer.
 */
export type ModuleOAuthResult =
  | { status: "finishing"; connectCode: string; label: string }
  | { status: "connected"; label: string }
  | { status: "error"; message: string };

/** The provider's name for messages: the integration id, capitalized. */
function integrationLabel(integration: string): string {
  return integration.charAt(0).toUpperCase() + integration.slice(1);
}

/**
 * Finishes a module integration's OAuth connect on the page its callback
 * returned to, and reports how it went.
 *
 * Only the integration, a one-time code and an error code are read from the
 * query string; the text shown is fixed (lib/oauthErrors.ts). An `oauth_code`
 * is redeemed by moduleOAuth.finish, which only the member who started the
 * connect can do. Once read, the query string is replaced by `returnSearch`,
 * so a reload does not try to redeem the code again.
 */
export function useModuleOAuthReturn(returnSearch = ""): [ModuleOAuthResult | null, () => void] {
  const [location, navigate] = useLocation();
  const [result, setResult] = useState<ModuleOAuthResult | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    if (!integration) {
      return null;
    }
    const label = integrationLabel(integration);
    const oauthCode = params.get("oauth_code");
    if (oauthCode) {
      return { status: "finishing", connectCode: oauthCode, label };
    }
    if (params.get("status") === "error") {
      return { status: "error", message: oauthErrorMessage(params.get("error"), label) };
    }
    return null;
  });

  const finishModuleOAuth = useModuleOAuthFinishRequest();
  const { isAuthenticated } = useConvexAuth();
  const finishingCodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated || result?.status !== "finishing" || finishingCodeRef.current === result.connectCode) {
      return;
    }
    finishingCodeRef.current = result.connectCode;
    const { label } = result;
    finishModuleOAuth(result.connectCode)
      .then((finished) => {
        setResult(
          finished.ok
            ? { status: "connected", label }
            : { status: "error", message: oauthErrorMessage(finished.error, label) }
        );
      })
      .catch((err: unknown) => {
        console.error("[modules] finishing the OAuth connect failed:", String(err));
        setResult({ status: "error", message: oauthErrorMessage(null, label) });
      });
  }, [finishModuleOAuth, isAuthenticated, result]);

  const urlStrippedRef = useRef(false);
  useEffect(() => {
    if (!result || urlStrippedRef.current) {
      return;
    }
    urlStrippedRef.current = true;
    navigate(`${location}${returnSearch}`, { replace: true });
  }, [location, navigate, result, returnSearch]);

  return [result, () => setResult(null)];
}
