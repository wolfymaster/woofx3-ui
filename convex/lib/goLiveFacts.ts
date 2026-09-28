// What the Go live checklist's Convex functions report back to the browser.
// Facts only: whether a fact passes, warns or fails is decided by the rules in
// client/src/lib/go-live-checks.ts, next to the fixes they offer.

/** Every check the checklist runs. Dismissals are stored by these ids, so renaming one resurfaces it. */
export const GO_LIVE_CHECK_IDS = ["engine", "twitch", "overlays", "obs", "stream-info", "workflows"] as const;

export type GoLiveCheckId = (typeof GO_LIVE_CHECK_IDS)[number];

export function isGoLiveCheckId(value: string): value is GoLiveCheckId {
  return (GO_LIVE_CHECK_IDS as readonly string[]).includes(value);
}

export type TwitchLinkFacts =
  | { linked: false }
  | {
      linked: true;
      login: string;
      /** False when Twitch refused the token and it could not be refreshed. */
      tokenValid: boolean;
      tokenProblem: string | null;
      /** Scopes of required Twitch capabilities this link was never granted; optional ones are left out. */
      missingScopes: string[];
    };

export type ObsFacts =
  | { kind: "connected"; sceneCount: number }
  | { kind: "disconnected"; reason: string }
  /** The engine predates the OBS listing call, so the question cannot be asked. */
  | { kind: "engine-update-needed" }
  | { kind: "engine-unreachable"; message: string };

export type StreamInfoFacts =
  | { kind: "unlinked" }
  | {
      kind: "ok";
      login: string;
      title: string;
      categoryId: string;
      categoryName: string;
      tags: string[];
    };

/** The channel as it stood when the checklist was last completed. */
export interface LastGoLive {
  completedAt: number;
  title: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

export interface OverlayFacts {
  hasScene: boolean;
  /** Browser-source keys meant for OBS; the scene editor's preview keys are not counted. */
  browserSourceKeyCount: number;
  /** The key most recently loaded by a browser source, else the newest one. */
  featuredKey: string | null;
  /** When any browser source last loaded one of those keys. */
  lastLoadedAt: number | null;
}

export interface WorkflowFacts {
  /** Whether the instance has any workflow at all, enabled or not. */
  any: boolean;
  /** Enabled workflows, counted up to a cap. */
  enabled: number;
  /** True when there are more enabled workflows than `enabled` says. */
  enabledCapped: boolean;
}

export type GoLiveStepOutcome =
  | { status: "done" }
  /** Waiting on something outside the request, such as the stream going live. */
  | { status: "queued"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; message: string };

export interface GoLiveCompletion {
  announcement: GoLiveStepOutcome;
  marker: GoLiveStepOutcome;
}
