import type { StatusGateway } from "@/engine/gateway";
import type { EngineConnectionTest, EngineInfo, InstanceLiveState } from "@/engine/types";
import { directKeys as k } from "./keys";
import { toInstanceLiveState } from "./map/live-state";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { unsupportedRead, unsupportedRequest } from "./unsupported";

export function liveStateRead(runtime: DirectRuntime): EngineRead<InstanceLiveState> {
  return {
    queryKey: k.status.liveState(),
    queryFn: async () => {
      const [status, sessions] = await Promise.all([
        runtime.call("getStreamStatus", (api) => api.getStreamStatus()),
        runtime.call("listStreamSessions", (api) => api.listStreamSessions({ limit: 1 })),
      ]);
      return toInstanceLiveState(status, sessions.sessions[0] ?? null, runtime.clock.now());
    },
  };
}

/**
 * The stream state is read from the engine and kept current by its stream
 * and session events. No mirror stands between, so there is nothing to sync.
 */
export function directStatusGateway(runtime: DirectRuntime): StatusGateway {
  // Null when the engine did not answer, as the contract has it; the reason
  // goes to the log, since the caller cannot act on it.
  const engineInfo = async (): Promise<EngineInfo | null> => {
    try {
      return await runtime.call("getEngineInfo", (api) => api.getEngineInfo());
    } catch (error) {
      runtime.logger.warn("DirectGateway: the engine did not say what it is", { error });
      return null;
    }
  };

  const setOverlayPublicUrl = (value: string) =>
    runtime.call("setOverlayPublicUrl", (api) => api.setOverlayPublicUrl(value));

  // Names its engine by URL, so it needs no scope and no session.
  const testConnection = async (url: string): Promise<EngineConnectionTest> => {
    const target = url.trim();
    if (target === "") {
      return { ok: false, error: "No engine URL provided" };
    }
    try {
      await runtime.ping(target);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const obsStatus = () => runtime.call("getObsStatus", (api) => api.getObsStatus());

  const pollLiveState = async (): Promise<{ ok: boolean }> => {
    const read = liveStateRead(runtime);
    try {
      await runtime.queryClient.fetchQuery({ ...read, staleTime: 0 });
      return { ok: true };
    } catch (error) {
      runtime.logger.warn("DirectGateway: could not read the stream state", { error });
      return { ok: false };
    }
  };

  return {
    useEngineInfoRequest: () => useEngineRequest(engineInfo),
    useSetOverlayPublicUrlRequest: () => useEngineRequest(setOverlayPublicUrl),
    useConnectionTestRequest: () => testConnection,
    useObsStatusRequest: () => useEngineRequest(obsStatus),
    useLiveState: () => useEngineQuery(runtime, liveStateRead(runtime)),
    useLiveStatePollRequest: () => useEngineRequest(pollLiveState),
    useSyncState: unsupportedRead("status.useSyncState"),
    useSyncRequest: unsupportedRequest("status.useSyncRequest"),
  };
}
