/** What the last save attempt came to. */
export type FlowSavePhase = "idle" | "saving" | "failed";

export type FlowSaveTone = "saved" | "unsaved" | "saving" | "failed" | "blocked";

export interface FlowSaveFacts {
  /** The flow differs from what was last saved. */
  changed: boolean;
  phase: FlowSavePhase;
  /** Why the current steps can't be saved, in the streamer's words. */
  problem: string | null;
  /** Why nothing can be saved yet, for a flow that doesn't exist until it has a step. */
  notSavedYet: string | null;
}

export interface FlowSaveView {
  tone: FlowSaveTone;
  text: string;
}

/**
 * The one sentence a flow says about its changes. A problem outranks a failed save because
 * retrying can't succeed until it is fixed; a save in flight outranks both, since what it
 * comes to is what happens next.
 */
export function flowSaveView({ changed, phase, problem, notSavedYet }: FlowSaveFacts): FlowSaveView {
  if (phase === "saving") {
    return { tone: "saving", text: "Saving…" };
  }
  if (notSavedYet !== null) {
    return { tone: "unsaved", text: notSavedYet };
  }
  if (!changed) {
    return { tone: "saved", text: "All changes saved" };
  }
  if (problem !== null) {
    return { tone: "blocked", text: `Can't save yet. ${problem}` };
  }
  if (phase === "failed") {
    return { tone: "failed", text: "Couldn't save. Your changes are still here." };
  }
  return { tone: "unsaved", text: "Unsaved changes" };
}

/** Told when a save was refused because the steps had changed since they were read. */
export const STEPS_CHANGED_TOAST = {
  title: "These steps changed somewhere else",
  description: "Showing the latest steps. Your last change wasn't saved, so make it again if you still need it.",
  variant: "destructive",
} as const;
