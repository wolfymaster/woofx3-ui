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
  alertLibrary: {
    all: ["alertLibrary"] as const,
    list: () => ["alertLibrary", "list"] as const,
    detail: (engineCompositionId: string) => ["alertLibrary", "detail", engineCompositionId] as const,
  },
  scenes: {
    all: ["scenes"] as const,
    list: () => ["scenes", "list"] as const,
    detail: (engineSceneId: string) => ["scenes", "detail", engineSceneId] as const,
    widgetCatalog: () => ["scenes", "widgetCatalog"] as const,
    alertWidgetNames: () => ["scenes", "alertWidgetNames"] as const,
    allAlertTargetUsage: ["scenes", "alertTargetUsage"] as const,
    allWidgetThemes: ["scenes", "widgetThemes"] as const,
    widgetThemes: (widgetCanonicalId: string) => ["scenes", "widgetThemes", widgetCanonicalId] as const,
    alertTargetUsage: (engineSceneId: string) => ["scenes", "alertTargetUsage", engineSceneId] as const,
  },
  workflows: {
    all: ["workflows"] as const,
    list: () => ["workflows", "list"] as const,
    detail: (engineWorkflowId: string) => ["workflows", "detail", engineWorkflowId] as const,
    catalog: () => ["workflows", "catalog"] as const,
    allRuns: ["workflows", "run"] as const,
    run: (engineRunId: string) => ["workflows", "run", engineRunId] as const,
    allRunLists: ["workflows", "runs"] as const,
    runs: (engineWorkflowId: string, limit: number) => ["workflows", "runs", engineWorkflowId, limit] as const,
    health: () => ["workflows", "health"] as const,
  },
  uiSettings: {
    all: ["uiSettings"] as const,
    namespace: (namespace: string) => ["uiSettings", namespace] as const,
  },
  modules: {
    all: ["modules"] as const,
    installed: () => ["modules", "installed"] as const,
    assets: (moduleId: string, kinds: readonly string[]) => ["modules", "assets", moduleId, ...kinds] as const,
  },
  moduleResources: {
    all: ["moduleResources"] as const,
    instances: () => ["moduleResources", "instances"] as const,
    ofKinds: (kinds: readonly string[]) => ["moduleResources", "ofKinds", ...kinds] as const,
    values: () => ["moduleResources", "values"] as const,
    kinds: () => ["moduleResources", "kinds"] as const,
  },
  twitch: {
    all: ["twitch"] as const,
    link: () => ["twitch", "link"] as const,
  },
  shoutouts: {
    all: ["shoutouts"] as const,
    queue: () => ["shoutouts", "queue"] as const,
  },
  commands: {
    all: ["commands"] as const,
    list: () => ["commands", "list"] as const,
    groups: () => ["commands", "groups"] as const,
    members: (engineGroupId: string) => ["commands", "members", engineGroupId] as const,
  },
};
