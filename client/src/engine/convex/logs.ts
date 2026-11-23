import { api } from "@convex/_generated/api";
import type { LogsGateway } from "@/engine/gateway";
import { useInstanceAction } from "./scope";

// The engine's log routes are plain HTTP, so Convex first checks the viewer
// (any member to read, an admin to export) and has the engine sign the
// address; the browser then dials the engine itself.

export const convexLogsGateway: LogsGateway = {
  useLogsRequests: () => {
    const listFiles = useInstanceAction(api.engineLogs.listFiles);
    const query = useInstanceAction(api.engineLogs.search);
    const access = useInstanceAction(api.engineLogs.access);
    return {
      listFiles: () => listFiles({}),
      query: (logQuery) => query({ query: logQuery }),
      access: (scope) => access({ scope }),
    };
  },
};
