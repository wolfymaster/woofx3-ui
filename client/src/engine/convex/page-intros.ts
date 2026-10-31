import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import type { PageIntrosGateway } from "@/engine/gateway";
import { isPageIntroId } from "@/lib/page-intros";

// Dismissals belong to the signed-in user, not the instance, so these need no
// engine scope.

function useDismissed(): readonly string[] | undefined {
  return useQuery(api.pageIntros.listDismissed);
}

function useDismissRequest() {
  const dismiss = useMutation(api.pageIntros.dismiss).withOptimisticUpdate((store, { introId: closed }) => {
    const current = store.getQuery(api.pageIntros.listDismissed, {});
    if (current !== undefined && !current.includes(closed)) {
      store.setQuery(api.pageIntros.listDismissed, {}, [...current, closed]);
    }
  });
  return useCallback(
    async (introId: string) => {
      if (!isPageIntroId(introId)) {
        throw new Error(`Unknown page intro ${introId}`);
      }
      await dismiss({ introId });
    },
    [dismiss]
  );
}

export const convexPageIntrosGateway: PageIntrosGateway = {
  useDismissed,
  useDismissRequest,
};
