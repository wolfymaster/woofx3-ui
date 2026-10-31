import { isGoLiveCheckId } from "@shared/go-live-check-ids";
import { readChannelInfoAnswer, STREAM_INFO_SCOPE } from "@shared/stream-info";
import { chatMessageProblem } from "@shared/twitch-chat";
import { missingRequiredTwitchScopes } from "@shared/twitch-scope-health";
import { ENGINE_CAPABILITIES, type UISetting } from "@woofx3/api";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import type { StreamStartMarkerRequest, StreamStartMarkers } from "@/engine/desktop-host";
import { GatewayUnsupportedError } from "@/engine/errors";
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
  GoLiveWorkflowFacts,
  LastGoLive,
  ReadOptions,
  Workflow,
} from "@/engine/types";
import { directKeys as k } from "./keys";
import { ACTIVE_TOKEN } from "./overlays";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";
import { sendChatMessage } from "./twitch-chat";
import {
  parseSetting,
  toSettingValue,
  UI_SETTING_NAMESPACES,
  type UISettingUpdate,
  uiSettingsRead,
  updateUISetting,
} from "./ui-settings";
import { workflowsRead } from "./workflows";

// The go-live checklist against one engine. What the checklist keeps between
// runs (its dismissals and the channel as it stood at the last go-live) is the
// dashboard's own, so it lives in the engine's local UI settings, under the
// keys below. The overlay and workflow facts are the engine's own reads, and
// the Twitch checks ask the engine's Twitch link and Helix methods.
//
// The "Stream start" marker is the one step that must outlive the page: one
// asked for before the stream is live is dropped when it goes live, so the
// desktop host keeps it, as Convex does for the hosted app.

const DISMISSED_KEY = "dismissedCheckIds";
const LAST_GO_LIVE_KEY = "lastGoLive";

/** Past this many enabled workflows the checklist just says "20+"; must match WORKFLOW_COUNT_CAP in convex/goLive.ts. */
const WORKFLOW_COUNT_CAP = 20;

const TOKEN_REFUSED_PROBLEM = "Twitch no longer accepts the connection";

const dismissedSchema = z.array(z.string());

const lastGoLiveSchema = z.object({
  completedAt: z.number(),
  title: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
});

const findKey = (settings: UISetting[], key: string): UISetting | null =>
  settings.find((setting) => setting.key === key) ?? null;

/** Enabled workflows counted up to the cap, as the Convex gateway counts them. */
function toWorkflowFacts(workflows: Workflow[]): GoLiveWorkflowFacts {
  const enabled = workflows.filter((workflow) => workflow.isEnabled).length;
  return {
    any: workflows.length > 0,
    enabled: Math.min(enabled, WORKFLOW_COUNT_CAP),
    enabledCapped: enabled > WORKFLOW_COUNT_CAP,
  };
}

function toStepOutcome(request: StreamStartMarkerRequest): GoLiveStepOutcome {
  switch (request.status) {
    case "done": {
      return { status: "done" };
    }
    case "queued": {
      return { status: "queued", reason: request.reason };
    }
    case "failed": {
      return { status: "failed", message: request.message };
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function directGoLiveGateway(runtime: DirectRuntime, markers: StreamStartMarkers): GoLiveGateway {
  const { logger } = runtime;
  const namespace = UI_SETTING_NAMESPACES.goLiveChecklist;
  const twitch = directTwitch(runtime);
  const settingsRead = uiSettingsRead(runtime, namespace, "goLive.useChecklist");
  const workflows = workflowsRead(runtime);
  const markerRead: EngineRead<boolean> = { queryKey: k.goLive.marker(), queryFn: () => markers.isPending() };

  const readDismissed = (setting: UISetting | null): GoLiveCheckId[] =>
    ((setting && parseSetting(logger, dismissedSchema, setting)) ?? []).filter(isGoLiveCheckId);
  const readLastGoLive = (setting: UISetting | null): LastGoLive | null =>
    setting && parseSetting(logger, lastGoLiveSchema, setting);

  // Built once per gateway so each selected value keeps its identity until its read changes.
  const selectKept = (settings: UISetting[]) => ({
    dismissedCheckIds: readDismissed(findKey(settings, DISMISSED_KEY)),
    lastGoLive: readLastGoLive(findKey(settings, LAST_GO_LIVE_KEY)),
  });

  const browserSourcesRead: EngineRead<GoLiveOverlayFacts> = {
    queryKey: k.scenes.browserSources(),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.scenesSnapshots)) {
        throw new GatewayUnsupportedError("goLive.useOverlays");
      }
      const [{ scenes }, tokens] = await Promise.all([
        runtime.call("listSceneSnapshots", (api) => api.listSceneSnapshots()),
        runtime.call("listOverlayTokens", (api) => api.listOverlayTokens()),
      ]);
      const sceneIds = new Set(scenes.filter((scene) => scene.kind === "scene").map((scene) => scene.id));
      const active = tokens
        .filter((token) => token.status === ACTIVE_TOKEN && sceneIds.has(token.sceneId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        hasScene: sceneIds.size > 0,
        browserSourceKeyCount: active.length,
        featuredUrl: active[0]?.url ?? null,
        // The engine does not record when a browser source loads its URL.
        lastLoadedAt: null,
      };
    },
  };

  /**
   * Keeps the cached marker read current with the host's changes until the
   * returned stop is called; a listener the host attaches after the stop is
   * detached at once.
   */
  const followMarker = (): (() => void) => {
    let unlisten: (() => void) | null = null;
    let stopped = false;
    markers
      .onPendingChange((pending) => runtime.queryClient.setQueryData(markerRead.queryKey, pending))
      .then(
        (stop) => {
          if (stopped) {
            stop();
            return;
          }
          unlisten = stop;
        },
        (error: unknown) => {
          logger.warn("goLive: could not follow the stream start marker", { error });
        }
      );
    return () => {
      stopped = true;
      unlisten?.();
    };
  };

  function useChecklist({ enabled = true }: ReadOptions = {}): GoLiveChecklistState | null | undefined {
    const kept = useEngineQuery(runtime, settingsRead, { enabled, select: selectKept });
    const workflowFacts = useEngineQuery(runtime, workflows, { enabled, select: toWorkflowFacts });
    const markerPending = useEngineQuery(runtime, markerRead, { enabled });
    useEffect(() => (enabled ? followMarker() : undefined), [enabled]);
    return useMemo(() => {
      if (kept === undefined || workflowFacts === undefined || markerPending === undefined) {
        return undefined;
      }
      return { ...kept, markerPending, workflows: workflowFacts };
    }, [kept, workflowFacts, markerPending]);
  }

  const setCheckDismissed = async (checkId: GoLiveCheckId, dismissed: boolean): Promise<void> => {
    await updateUISetting(
      runtime,
      namespace,
      DISMISSED_KEY,
      (current) => {
        const ids = new Set(readDismissed(current));
        if (dismissed) {
          ids.add(checkId);
        } else {
          ids.delete(checkId);
        }
        return { kind: "write", value: toSettingValue(Array.from(ids).sort()) };
      },
      "goLive.useSetCheckDismissedRequest"
    );
  };

  /**
   * The engine renews the token itself and records when Twitch refused a
   * renewal, so the link read fresh says whether Twitch still accepts it.
   */
  const checkTwitch = async (): Promise<GoLiveTwitchFacts> => {
    const link = await runtime.queryClient.fetchQuery({ ...twitch.linkRead, staleTime: 0 });
    if (!link.linked) {
      return { linked: false };
    }
    const refused = link.authFailedAt !== null;
    return {
      linked: true,
      login: link.login ?? link.displayName ?? link.userId,
      tokenValid: !refused,
      tokenProblem: refused ? TOKEN_REFUSED_PROBLEM : null,
      missingScopes: missingRequiredTwitchScopes(link.scopes),
    };
  };

  const readChannel = async () =>
    readChannelInfoAnswer(
      await twitch.helix(ENGINE_CAPABILITIES.twitchStreamInfo, "twitchGetChannelInformation", (api) =>
        api.twitchGetChannelInformation()
      )
    );

  const checkStreamInfo = async (): Promise<GoLiveStreamInfoFacts> => {
    const link = await runtime.queryClient.fetchQuery(twitch.linkRead);
    if (!link.linked) {
      return { kind: "unlinked" };
    }
    try {
      const channel = await readChannel();
      return {
        kind: "ok",
        login: link.login ?? link.displayName ?? link.userId,
        title: channel.title,
        categoryId: channel.category?.id ?? "",
        categoryName: channel.category?.name ?? "",
        tags: channel.tags,
      };
    } catch (error) {
      throw new Error(`Couldn't read your stream info from Twitch: ${messageOf(error)}`);
    }
  };

  const announce = async (text: string | undefined): Promise<GoLiveStepOutcome> => {
    if (text === undefined) {
      return { status: "skipped", reason: "No announcement was asked for" };
    }
    try {
      await sendChatMessage(twitch, text);
      return { status: "done" };
    } catch (error) {
      return { status: "failed", message: messageOf(error) };
    }
  };

  const dropMarker = async (asked: boolean): Promise<GoLiveStepOutcome> => {
    if (!asked) {
      return { status: "skipped", reason: "No stream marker was asked for" };
    }
    try {
      await twitch.authorize(STREAM_INFO_SCOPE);
      return toStepOutcome(await markers.request());
    } catch (error) {
      return { status: "failed", message: messageOf(error) };
    } finally {
      await runtime.queryClient.invalidateQueries({ queryKey: markerRead.queryKey });
    }
  };

  /**
   * Records the run as the last go-live. A channel read that fails leaves the
   * previous title and category in place: stale comparison data beats none.
   */
  const recordCompletion = async (completedAt: number): Promise<void> => {
    let channel: Pick<LastGoLive, "title" | "categoryId" | "categoryName"> | null = null;
    try {
      const info = await readChannel();
      channel = { title: info.title, categoryId: info.category?.id ?? "", categoryName: info.category?.name ?? "" };
    } catch (error) {
      logger.warn("goLive: could not read the channel to record the go-live", { error });
    }
    await updateUISetting(
      runtime,
      namespace,
      LAST_GO_LIVE_KEY,
      (current): UISettingUpdate => {
        const previous = readLastGoLive(current);
        const kept = channel ?? {
          title: previous?.title ?? null,
          categoryId: previous?.categoryId ?? null,
          categoryName: previous?.categoryName ?? null,
        };
        return { kind: "write", value: toSettingValue({ completedAt, ...kept }) };
      },
      "goLive.useCompleteRequest"
    );
  };

  const complete = async (finish: GoLiveFinish): Promise<GoLiveCompletion> => {
    // A bad announcement is refused before anything runs, as the Convex gateway refuses it.
    const problem = finish.announcement === undefined ? null : chatMessageProblem(finish.announcement.trim());
    if (problem) {
      throw new Error(problem);
    }
    const link = await runtime.queryClient.fetchQuery(twitch.linkRead);
    if (!link.linked) {
      throw new Error("Connect Twitch before finishing the checklist");
    }
    // Each step reports its own outcome: a chat send refused by automod should
    // not stop the marker, and neither should hide the other's result.
    const [announcement, marker] = await Promise.all([announce(finish.announcement), dropMarker(finish.dropMarker)]);
    // A run where everything asked for failed did not finish the checklist, so
    // it must not become the "last go-live" the next title check compares to.
    const requested = [announcement, marker].filter((outcome) => outcome.status !== "skipped");
    const allFailed = requested.length > 0 && requested.every((outcome) => outcome.status === "failed");
    if (!allFailed) {
      await recordCompletion(runtime.clock.now());
    }
    return { announcement, marker };
  };

  return {
    useChecklist,
    useOverlays: ({ enabled = true }: ReadOptions = {}) => useEngineQuery(runtime, browserSourcesRead, { enabled }),
    useSetCheckDismissedRequest: () => useEngineRequest(setCheckDismissed),
    useCheckTwitchRequest: () => useEngineRequest(checkTwitch),
    useCheckStreamInfoRequest: () => useEngineRequest(checkStreamInfo),
    useCompleteRequest: () => useEngineRequest(complete),
  };
}
