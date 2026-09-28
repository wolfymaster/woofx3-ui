import { api } from "@convex/_generated/api";
import type {
  GoLiveCheckId,
  GoLiveCompletion,
  ObsFacts,
  StreamInfoFacts,
  TwitchLinkFacts,
} from "@convex/lib/goLiveFacts";
import type { StreamInfoField } from "@convex/lib/streamInfo";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngineHealth } from "@/hooks/use-engine-health";
import { useInstance } from "@/hooks/use-instance";
import { useLiveState } from "@/hooks/use-live-state";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import {
  type ChecklistSummary,
  type CheckResult,
  engineCheck,
  erroredCheck,
  obsCheck,
  overlaysCheck,
  runningCheck,
  streamInfoCheck,
  summarizeChecklist,
  twitchCheck,
  workflowsCheck,
} from "@/lib/go-live-checks";

/** The checks that ask Twitch or the engine, each its own Convex action so they run side by side. */
type RemoteCheckId = Extract<GoLiveCheckId, "twitch" | "obs" | "stream-info">;
const REMOTE_CHECK_IDS: RemoteCheckId[] = ["twitch", "obs", "stream-info"];

/** What a remote check came back with, before the rules turn it into a result. */
type RemoteOutcome =
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "twitch"; facts: TwitchLinkFacts }
  | { kind: "obs"; facts: ObsFacts }
  | { kind: "stream-info"; facts: StreamInfoFacts };

export function errorMessage(error: unknown): string {
  // ConvexError carries the user-facing text in `data`; a production
  // deployment replaces a plain Error's message with "Server Error".
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface GoLiveChecklist {
  /** Null until the instance and its checklist row have loaded. */
  summary: ChecklistSummary | null;
  isLive: boolean;
  /** A "Stream start" marker is waiting for the stream to go live. */
  markerPending: boolean;
  runAll: () => void;
  rerun: (id: GoLiveCheckId) => void;
  setDismissed: (id: GoLiveCheckId, dismissed: boolean) => Promise<void>;
  complete: (options: { announcement?: string; dropMarker: boolean }) => Promise<GoLiveCompletion>;
  /** Writes a saved preset's title, category and tags to Twitch; returns the fields Twitch kept its own. */
  applyPreset: (presetId: string) => Promise<StreamInfoField[]>;
}

export function useGoLiveChecklist(): GoLiveChecklist {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const { connected } = useEngineHealth();
  const liveState = useLiveState();
  const local = useQuery(api.goLive.checklist, instanceId ? { instanceId } : "skip");
  const overlays = useQuery(api.goLive.overlays, instanceId ? { instanceId } : "skip");
  const presets = useQuery(api.streamInfo.listPresets, instanceId ? { instanceId } : "skip");

  const checkTwitch = useAction(api.goLive.checkTwitch);
  const checkObs = useAction(api.goLive.checkObs);
  const checkStreamInfo = useAction(api.goLive.checkStreamInfo);
  const setCheckDismissed = useMutation(api.goLive.setCheckDismissed);
  const completeAction = useAction(api.goLive.complete);
  const updateChannelInfo = useAction(api.streamInfo.updateChannelInfo);

  const [outcomes, setOutcomes] = useState<Record<RemoteCheckId, RemoteOutcome>>({
    twitch: { kind: "running" },
    obs: { kind: "running" },
    "stream-info": { kind: "running" },
  });
  // Only the newest run of a check may write its outcome: a slow answer from
  // an earlier run, or from the instance the user just switched away from,
  // would otherwise overwrite a fresher one.
  const runIds = useRef<Record<RemoteCheckId, number>>({ twitch: 0, obs: 0, "stream-info": 0 });

  const runRemote = useCallback(
    (id: RemoteCheckId) => {
      if (!instanceId) {
        return;
      }
      runIds.current[id] += 1;
      const runId = runIds.current[id];
      const settle = (outcome: RemoteOutcome) => {
        if (runIds.current[id] === runId) {
          setOutcomes((previous) => ({ ...previous, [id]: outcome }));
        }
      };
      settle({ kind: "running" });

      let pending: Promise<RemoteOutcome>;
      if (id === "twitch") {
        pending = checkTwitch({ instanceId }).then((facts) => ({ kind: "twitch", facts }));
      } else if (id === "obs") {
        pending = checkObs({ instanceId }).then((facts) => ({ kind: "obs", facts }));
      } else {
        pending = checkStreamInfo({ instanceId }).then((facts) => ({ kind: "stream-info", facts }));
      }
      pending.then(settle, (error: unknown) => settle({ kind: "error", message: errorMessage(error) }));
    },
    [instanceId, checkTwitch, checkObs, checkStreamInfo]
  );

  const runAll = useCallback(() => {
    for (const id of REMOTE_CHECK_IDS) {
      runRemote(id);
    }
  }, [runRemote]);

  useEffect(() => {
    runAll();
  }, [runAll]);

  const rerun = useCallback(
    (id: GoLiveCheckId) => {
      if ((REMOTE_CHECK_IDS as GoLiveCheckId[]).includes(id)) {
        runRemote(id as RemoteCheckId);
      }
      // The other checks read live state and are always current.
    },
    [runRemote]
  );

  const summary = useMemo((): ChecklistSummary | null => {
    if (!local || !overlays) {
      return null;
    }
    const now = Date.now();
    const remote = (id: RemoteCheckId): CheckResult => {
      const outcome = outcomes[id];
      switch (outcome.kind) {
        case "running": {
          return runningCheck(id);
        }
        case "error": {
          return erroredCheck(id, outcome.message);
        }
        case "twitch": {
          return twitchCheck(outcome.facts);
        }
        case "obs": {
          return obsCheck(outcome.facts);
        }
        case "stream-info": {
          return streamInfoCheck(outcome.facts, local.lastGoLive, now, presets ?? []);
        }
      }
    };
    const featuredKey = overlays.featuredKey;
    const results: CheckResult[] = [
      engineCheck(connected),
      remote("twitch"),
      overlaysCheck(overlays, featuredKey ? browserSourceUrlForKey(featuredKey) : null, now),
      remote("obs"),
      remote("stream-info"),
      workflowsCheck(local.workflows),
    ];
    return summarizeChecklist(results, local.dismissedCheckIds);
  }, [local, overlays, outcomes, connected, presets]);

  const setDismissed = useCallback(
    async (id: GoLiveCheckId, dismissed: boolean) => {
      if (!instanceId) {
        return;
      }
      await setCheckDismissed({ instanceId, checkId: id, dismissed });
    },
    [instanceId, setCheckDismissed]
  );

  const complete = useCallback(
    async (options: { announcement?: string; dropMarker: boolean }) => {
      if (!instanceId) {
        throw new Error("Pick an instance first");
      }
      const result = await completeAction({ instanceId, ...options });
      // The stored title and category just changed, so stream info is
      // measured against them from here on.
      runRemote("stream-info");
      return result;
    },
    [instanceId, completeAction, runRemote]
  );

  const applyPreset = useCallback(
    async (presetId: string) => {
      if (!instanceId) {
        throw new Error("Pick an instance first");
      }
      const preset = presets?.find((candidate) => candidate.id === presetId);
      if (!preset) {
        throw new Error("That preset no longer exists");
      }
      try {
        const { unapplied } = await updateChannelInfo({ instanceId, ...preset.info });
        return unapplied;
      } finally {
        runRemote("stream-info");
      }
    },
    [instanceId, presets, updateChannelInfo, runRemote]
  );

  return {
    summary,
    isLive: liveState?.isLive ?? false,
    markerPending: local?.markerPending ?? false,
    runAll,
    rerun,
    setDismissed,
    complete,
    applyPreset,
  };
}
