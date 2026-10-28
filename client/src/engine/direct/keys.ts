// Every query key the direct gateway caches under, rooted at its namespace,
// so invalidating a namespace's root covers all of its reads and a read's
// arguments are the rest of its key. Keys never name the engine: one runtime
// talks to one engine, and a new target clears the whole cache.

export const directKeys = {
  status: {
    all: ["status"] as const,
    liveState: () => ["status", "liveState"] as const,
  },
  alertQueue: {
    all: ["alertQueue"] as const,
    alerts: (limit: number) => ["alertQueue", "alerts", limit] as const,
    overview: (hourStart: number) => ["alertQueue", "overview", hourStart] as const,
  },
  commands: {
    all: ["commands"] as const,
    list: () => ["commands", "list"] as const,
    groups: () => ["commands", "groups"] as const,
    members: (engineGroupId: string) => ["commands", "members", engineGroupId] as const,
  },
};
