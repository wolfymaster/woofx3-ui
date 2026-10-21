import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ModuleOAuthGateway } from "@/engine/gateway";
import type { ModuleOAuthConnect, ModuleOAuthFinish } from "@/engine/types";
import { useInstanceAction } from "./scope";

// Convex runs the OAuth dance: it builds the authorize URL from the module's
// manifest and the client id the engine holds, receives the provider's
// callback, and hands the code to the engine, which exchanges and keeps the
// tokens. The callback comes back to the page with a one-time connect code.

type FinishRow = FunctionReturnType<typeof api.moduleOAuth.finish>;

export function toModuleOAuthFinish(result: FinishRow): ModuleOAuthFinish {
  return result.ok ? { ok: true, integration: result.integration } : { ok: false, error: result.error };
}

function useConnectRequest() {
  const start = useInstanceAction(api.moduleOAuth.start);
  return useCallback(
    async ({ moduleId, integration, returnTo }: ModuleOAuthConnect) => {
      const { authorizeUrl } = await start({ moduleId, integration, redirectTo: returnTo });
      window.location.assign(authorizeUrl);
    },
    [start]
  );
}

function useFinishRequest() {
  const finish = useAction(api.moduleOAuth.finish);
  return useCallback(async (connectCode: string) => toModuleOAuthFinish(await finish({ code: connectCode })), [finish]);
}

export const convexModuleOAuthGateway: ModuleOAuthGateway = {
  useConnectRequest,
  useFinishRequest,
};
