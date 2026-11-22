import type { OrgEngine } from "@convex/organizations";

export type HealthTone = "good" | "warning" | "bad" | "neutral";

export interface EngineHealth {
  label: string;
  tone: HealthTone;
  /** What the label rests on, shown beside it. */
  reasons: string[];
}

interface HealthInputs {
  engine: Pick<OrgEngine, "hosting" | "status">;
  /** A linked streaming account whose sign-in the platform refused, so automation on it is not running. */
  linkNeedsReconnect: boolean;
  lastEngineActivityAt: number | null;
}

const SETTING_UP: ReadonlyArray<NonNullable<OrgEngine["status"]>> = [
  "requested",
  "provisioning",
  "ready",
  "registering",
  "starting",
];

/** One reading of how an engine is doing, from where its build stands and what its links report. */
export function engineHealth({ engine, linkNeedsReconnect, lastEngineActivityAt }: HealthInputs): EngineHealth {
  const { status } = engine;
  if (status === "failed") {
    return { label: "Needs attention", tone: "bad", reasons: ["Setup failed. Try again or contact support."] };
  }
  if (status === "stopped" || status === "stopping") {
    return { label: "Paused", tone: "neutral", reasons: ["Paused because your subscription ended."] };
  }
  if (status === "deprovisioning" || status === "deleted") {
    return { label: "Being deleted", tone: "neutral", reasons: [] };
  }
  if (status === "upgrading") {
    return { label: "Upgrading", tone: "neutral", reasons: [] };
  }
  if (status !== null && SETTING_UP.includes(status)) {
    return { label: "Setting up", tone: "neutral", reasons: [] };
  }
  if (engine.hosting === "external" && lastEngineActivityAt === null) {
    return {
      label: "Not connected yet",
      tone: "warning",
      reasons: ["Hasn't connected yet. Open the dashboard once to start it."],
    };
  }
  if (linkNeedsReconnect) {
    return { label: "Needs attention", tone: "warning", reasons: ["Your Twitch account needs reconnecting."] };
  }
  return { label: "Healthy", tone: "good", reasons: [] };
}

/** Text colour for a tone, shared wherever a health reading is shown. */
export const TONE_CLASS: Record<HealthTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};
