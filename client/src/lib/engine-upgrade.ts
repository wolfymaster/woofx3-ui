/**
 * What the engine page says about an upgrade, as plain logic over the
 * provisioning row's `upgrade` record so the wording can be tested without
 * rendering anything.
 */
export interface EngineUpgrade {
  fromVersion: string;
  toVersion: string;
  rollingBack: boolean;
  outcome?: "succeeded" | "rolled_back" | "failed";
  error?: string;
  acknowledged?: boolean;
}

export interface UpgradeResult {
  tone: "success" | "warning";
  message: string;
  /** The maintenance API's own account of what went wrong, when something did. */
  detail?: string;
}

/** The heading over the run's steps while woofx3 is down. */
export function upgradeHeading(upgrade: EngineUpgrade): string {
  return upgrade.rollingBack ? "Restoring your previous version" : "Updating woofx3";
}

/**
 * How the last upgrade ended, until it is dismissed. Null for an engine that is
 * not running: one still upgrading has no outcome yet, and one left failed
 * shows its error and Retry instead, since it needs a repair rather than a
 * notice.
 */
export function upgradeResult(status: string, upgrade: EngineUpgrade | undefined): UpgradeResult | null {
  if (status !== "registered" || !upgrade?.outcome || upgrade.acknowledged) {
    return null;
  }
  switch (upgrade.outcome) {
    case "succeeded":
      return { tone: "success", message: "woofx3 is up to date." };
    case "rolled_back":
      return {
        tone: "warning",
        message: "The update didn't work, so we restored your previous version. Nothing was lost.",
        detail: upgrade.error,
      };
    case "failed":
      return {
        tone: "warning",
        message: "The update couldn't start. Nothing changed.",
        detail: upgrade.error,
      };
  }
}
