import { api } from "@convex/_generated/api";
import { isGoLiveCheckId } from "@convex/lib/goLiveFacts";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { GoLiveGateway } from "@/engine/gateway";
import type {
  GoLiveCheckId,
  GoLiveChecklistState,
  GoLiveCompletion,
  GoLiveFinish,
  GoLiveOverlayFacts,
  GoLiveStepOutcome,
  GoLiveStreamInfoFacts,
  GoLiveTwitchFacts,
  ReadOptions,
} from "@/engine/types";
import { withPlainError } from "./errors";
import { useMappedValue } from "./mapped";
import { useInstanceAction, useInstanceMutation, useScopeInstanceId } from "./scope";

// Convex keeps the checklist's dismissals and last run, reads the overlay and
// workflow facts from its own tables, and asks Twitch with the broadcaster
// token it holds. Finishing posts through the engine when the engine
// advertises `twitch.chat`.

type ChecklistRow = NonNullable<FunctionReturnType<typeof api.goLive.checklist>>;
type OverlaysRow = NonNullable<FunctionReturnType<typeof api.goLive.overlays>>;
type TwitchFactsRow = FunctionReturnType<typeof api.goLive.checkTwitch>;
type StreamInfoFactsRow = FunctionReturnType<typeof api.goLive.checkStreamInfo>;
type CompletionRow = FunctionReturnType<typeof api.goLive.complete>;
type StepOutcomeRow = CompletionRow["announcement"];

export function toGoLiveChecklistState(row: ChecklistRow): GoLiveChecklistState {
  return {
    // Convex stores the ids as strings; one this client no longer knows is dropped.
    dismissedCheckIds: row.dismissedCheckIds.filter(isGoLiveCheckId),
    lastGoLive: row.lastGoLive
      ? {
          completedAt: row.lastGoLive.completedAt,
          title: row.lastGoLive.title,
          categoryId: row.lastGoLive.categoryId,
          categoryName: row.lastGoLive.categoryName,
        }
      : null,
    markerPending: row.markerPending,
    workflows: {
      any: row.workflows.any,
      enabled: row.workflows.enabled,
      enabledCapped: row.workflows.enabledCapped,
    },
  };
}

export function toGoLiveOverlayFacts(row: OverlaysRow): GoLiveOverlayFacts {
  return {
    hasScene: row.hasScene,
    browserSourceKeyCount: row.browserSourceKeyCount,
    featuredKey: row.featuredKey,
    lastLoadedAt: row.lastLoadedAt,
  };
}

export function toGoLiveTwitchFacts(facts: TwitchFactsRow): GoLiveTwitchFacts {
  if (!facts.linked) {
    return { linked: false };
  }
  return {
    linked: true,
    login: facts.login,
    tokenValid: facts.tokenValid,
    tokenProblem: facts.tokenProblem,
    missingScopes: facts.missingScopes,
  };
}

export function toGoLiveStreamInfoFacts(facts: StreamInfoFactsRow): GoLiveStreamInfoFacts {
  if (facts.kind === "unlinked") {
    return { kind: "unlinked" };
  }
  return {
    kind: "ok",
    login: facts.login,
    title: facts.title,
    categoryId: facts.categoryId,
    categoryName: facts.categoryName,
    tags: facts.tags,
  };
}

function toGoLiveStepOutcome(outcome: StepOutcomeRow): GoLiveStepOutcome {
  switch (outcome.status) {
    case "done": {
      return { status: "done" };
    }
    case "queued":
    case "skipped": {
      return { status: outcome.status, reason: outcome.reason };
    }
    case "failed": {
      return { status: "failed", message: outcome.message };
    }
  }
}

export function toGoLiveCompletion(completion: CompletionRow): GoLiveCompletion {
  return {
    announcement: toGoLiveStepOutcome(completion.announcement),
    marker: toGoLiveStepOutcome(completion.marker),
  };
}

function useChecklist({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(api.goLive.checklist, enabled && instanceId ? { instanceId } : "skip");
  return useMappedValue(row, toGoLiveChecklistState);
}

function useOverlays({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(api.goLive.overlays, enabled && instanceId ? { instanceId } : "skip");
  return useMappedValue(row, toGoLiveOverlayFacts);
}

function useSetCheckDismissedRequest() {
  const setCheckDismissed = useInstanceMutation(api.goLive.setCheckDismissed);
  return useCallback(
    async (checkId: GoLiveCheckId, dismissed: boolean) => {
      await setCheckDismissed({ checkId, dismissed }).catch(withPlainError);
    },
    [setCheckDismissed]
  );
}

function useCheckTwitchRequest() {
  const checkTwitch = useInstanceAction(api.goLive.checkTwitch);
  return useCallback(async () => toGoLiveTwitchFacts(await checkTwitch({}).catch(withPlainError)), [checkTwitch]);
}

function useCheckStreamInfoRequest() {
  const checkStreamInfo = useInstanceAction(api.goLive.checkStreamInfo);
  return useCallback(
    async () => toGoLiveStreamInfoFacts(await checkStreamInfo({}).catch(withPlainError)),
    [checkStreamInfo]
  );
}

function useCompleteRequest() {
  const complete = useInstanceAction(api.goLive.complete);
  return useCallback(
    async ({ announcement, dropMarker }: GoLiveFinish) =>
      toGoLiveCompletion(await complete({ announcement, dropMarker }).catch(withPlainError)),
    [complete]
  );
}

export const convexGoLiveGateway: GoLiveGateway = {
  useChecklist,
  useOverlays,
  useSetCheckDismissedRequest,
  useCheckTwitchRequest,
  useCheckStreamInfoRequest,
  useCompleteRequest,
};
