/** How the build of a streamer's engine stands, as the screens waiting on it need it. */
export type EngineBuild =
  | {
      stage: "building";
      /** A plain-language name for the stage the run has reached. */
      message: string;
      /** What that stage is doing, in a sentence a first-time streamer can read. */
      detail: string;
      percent: number;
      /** The run's stages, grouped for a person rather than for an operator. */
      phases: readonly EngineBuildPhase[];
      /** Whole minutes since the build was asked for. */
      elapsedMinutes: number;
      /** Past the usual build time, so the wait deserves a different tone. */
      slow: boolean;
      /** Why the running step is still going, when the maintenance API says. */
      note: string | null;
    }
  | { stage: "failed"; retry: () => Promise<void> }
  | { stage: "ready" };

export type EngineBuildPhaseId = "engine" | "database" | "alerts" | "dashboard";
export type EngineBuildPhaseState = "done" | "current" | "todo";

export interface EngineBuildPhase {
  id: EngineBuildPhaseId;
  label: string;
  detail: string;
  state: EngineBuildPhaseState;
}

interface PhaseDefinition {
  id: EngineBuildPhaseId;
  label: string;
  detail: string;
}

/**
 * The run's steps grouped into four stages. The maintenance API's own labels
 * name databases, containers and routes; a streamer waiting on their first
 * engine is told what those mean for them instead. The admin engine page shows
 * the real steps, with errors and step details.
 */
const PHASES: readonly PhaseDefinition[] = [
  {
    id: "engine",
    label: "Waking up your engine",
    detail: "Finding a server and giving it room to run.",
  },
  {
    id: "database",
    label: "Making a home for your alerts",
    detail: "Setting up where your scenes, alerts and history live.",
  },
  {
    id: "alerts",
    label: "Installing your alerts",
    detail: "Putting your follows, subs and bits alerts in place.",
  },
  {
    id: "dashboard",
    label: "Connecting your dashboard",
    detail: "Introducing your engine to woofx3.",
  },
];

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

/** A build that runs past this has stopped feeling like the usual wait. */
export const SLOW_BUILD_AFTER_MINUTES = 5;

export function engineBuildIsSlow(elapsedMinutes: number): boolean {
  return elapsedMinutes >= SLOW_BUILD_AFTER_MINUTES;
}

/** "Just started" reads better than "0 minutes in" to someone who has only just arrived. */
export function buildElapsedLabel(elapsedMinutes: number): string {
  if (elapsedMinutes < 1) {
    return "Just started";
  }
  if (elapsedMinutes === 1) {
    return "About a minute in";
  }
  return `About ${elapsedMinutes} minutes in`;
}

/** What the running step is waiting on, shown only once the wait is unusually long. */
export function engineBuildNote(steps: readonly { status: string; detail?: string }[]): string | null {
  const running = steps.find((step) => step.status === "running");
  return running?.detail?.trim() || null;
}

/**
 * Which of the four stages a maintenance step belongs to. The keyword groups
 * are deliberately broad because the maintenance API owns its labels; anything
 * unrecognised falls back to how far the run has got.
 */
function phaseIndexFromLabel(label: string): number | null {
  const text = label.toLowerCase();
  if (/database|postgres|\bdb\b|sql|storage|volume|schema|migrat/.test(text)) {
    return 1;
  }
  if (/alert|module|workflow|scene|seed/.test(text)) {
    return 2;
  }
  if (/register|route|domain|dns|tls|cert|publish|callback|dashboard/.test(text)) {
    return 3;
  }
  if (/container|image|engine|server|deploy|provision|start|wake|pull|build|network/.test(text)) {
    return 0;
  }
  return null;
}

function clampPhase(index: number): number {
  return Math.max(0, Math.min(PHASES.length - 1, index));
}

function progressPhase(done: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  // Floor keeps the last phase current while the final steps finish, rather
  // than claiming the dashboard is connected before it is.
  return clampPhase(Math.floor((done / total) * PHASES.length));
}

/**
 * The stage the run is on. A step's own label wins; otherwise the completed
 * fraction of the run is the best available answer.
 */
export function engineBuildPhaseIndex(
  status: string | undefined,
  steps: readonly { label: string; status: string }[]
): number {
  const running = steps.find((step) => step.status === "running");
  if (running) {
    return phaseIndexFromLabel(running.label) ?? progressFallback(steps);
  }
  if (status === "registering" || status === "ready") {
    return 3;
  }
  const done = steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  if (steps.length > 0 && done >= steps.length) {
    return 3;
  }
  return progressFallback(steps);
}

function progressFallback(steps: readonly { status: string }[]): number {
  const done = steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  return progressPhase(done, steps.length);
}

/** The four stages with their state for the current run. */
export function engineBuildPhases(
  status: string | undefined,
  steps: readonly { label: string; status: string }[]
): EngineBuildPhase[] {
  const current = engineBuildPhaseIndex(status, steps);
  return PHASES.map((phase, index) => ({
    ...phase,
    state: index < current ? "done" : index === current ? "current" : "todo",
  }));
}

function currentPhase(
  status: string | undefined,
  steps: readonly { label: string; status: string }[]
): PhaseDefinition {
  return PHASES[engineBuildPhaseIndex(status, steps)];
}

export function engineBuildPhaseLabel(
  status: string | undefined,
  steps: readonly { label: string; status: string }[]
): string {
  return currentPhase(status, steps).label;
}

export function engineBuildPhaseDetail(
  status: string | undefined,
  steps: readonly { label: string; status: string }[]
): string {
  return currentPhase(status, steps).detail;
}

/** Whole minutes since the request was made, never negative if a clock disagrees. */
export function engineBuildElapsedMinutes(createdAt: number | undefined, now: number): number {
  if (createdAt === undefined) {
    return 0;
  }
  return Math.max(0, Math.floor((now - createdAt) / 60_000));
}
