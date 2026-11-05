/** How the build of a streamer's engine stands, as the screens waiting on it need it. */
export type EngineBuild =
  | { stage: "building"; message: string; percent: number }
  | { stage: "failed"; retry: () => Promise<void> }
  | { stage: "ready" };

const BUILD_MESSAGES: Record<string, string> = {
  requested: "Saving your spot",
  provisioning: "Building your overlay",
  ready: "Almost there",
  registering: "Connecting your dashboard",
};
const DEFAULT_BUILD_MESSAGE = "Getting things ready";

/** Plain words for a build's status, which also names states no first-time streamer should read about. */
export function engineBuildMessage(status: string | undefined): string {
  return (status !== undefined && BUILD_MESSAGES[status]) || DEFAULT_BUILD_MESSAGE;
}

const MIN_BUILD_PERCENT = 5;

/** A started bar even before the first step reports, since nothing else moves on the screen. */
export function engineBuildPercent(steps: readonly { status: string }[]): number {
  if (steps.length === 0) {
    return MIN_BUILD_PERCENT;
  }
  const done = steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  return Math.max(MIN_BUILD_PERCENT, Math.round((done / steps.length) * 100));
}
