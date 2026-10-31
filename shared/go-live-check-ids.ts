// The go-live checklist's checks, shared by Convex, which stores dismissals by
// these ids, and every engine gateway that keeps them.

/** Every check the checklist runs. Dismissals are stored by these ids, so renaming one resurfaces it. */
export const GO_LIVE_CHECK_IDS = ["engine", "twitch", "overlays", "obs", "stream-info", "workflows"] as const;

export type GoLiveCheckId = (typeof GO_LIVE_CHECK_IDS)[number];

export function isGoLiveCheckId(value: string): value is GoLiveCheckId {
  return (GO_LIVE_CHECK_IDS as readonly string[]).includes(value);
}
