import type { LogAccessScope, LogQuery } from "@woofx3/api";
import type { LogsGateway } from "@/engine/gateway";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

export function directLogsGateway(runtime: DirectRuntime): LogsGateway {
  // Defined once so each request function keeps its identity across renders.
  const listFiles = () => runtime.call("listLogFiles", (api) => api.listLogFiles());
  const query = (logQuery: LogQuery) => runtime.call("queryLogs", (api) => api.queryLogs(logQuery));
  const access = async (scope: LogAccessScope) => {
    const [origin, grant] = await Promise.all([
      runtime.engineOrigin(),
      runtime.call("createLogAccess", (api) => api.createLogAccess(scope)),
    ]);
    return { origin, ...grant };
  };
  return {
    // A lone computer has one person on it, who owns the engine.
    useCanExport: () => true,
    useLogsRequests: () => ({
      listFiles: useEngineRequest(listFiles),
      query: useEngineRequest(query),
      access: useEngineRequest(access),
    }),
  };
}
