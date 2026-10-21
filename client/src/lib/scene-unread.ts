import type { SceneRepairResult } from "@woofx3/api";
import type { UnreadColumn, UnreadReport } from "@woofx3/api/scene-editor/protocol";

/** What each stored column holds, in the words the editor uses for it. */
const COLUMN_NOUNS: Record<UnreadColumn, string> = {
  widgets: "layers",
  layout: "canvas settings",
  behaviors: "animations",
};

/** The columns a report lists, in a phrase: `the published layers and the draft's animations`. */
export function unreadColumnsText(report: UnreadReport): string {
  const parts = report.columns.map(({ version, column }) =>
    version === "published" ? `the published ${COLUMN_NOUNS[column]}` : `the draft's ${COLUMN_NOUNS[column]}`
  );
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Placements the engine could not read, across both versions. */
export function unreadPlacementCount(report: UnreadReport): number {
  return report.placements.published + report.placements.draft;
}

/** What happens to `count` unreadable layers, worded for one or several. */
export function unreadPlacementsText(count: number): string {
  return count === 1
    ? "It's kept as it was stored, but isn't shown or played."
    : "They're kept as they were stored, but aren't shown or played.";
}

/** Whether a session ended because the scene could not be read, rather than because it is gone. */
export function endedUnreadable(conn: string | null, unread: UnreadReport | null | undefined): boolean {
  return conn === "gone" && unread != null && unread.columns.length > 0;
}

/** The toast for a repair's answer. */
export function repairResultToast(
  result: SceneRepairResult,
  noun: string
): { title: string; description: string; variant?: "destructive" } {
  if (result.ok) {
    return {
      title: `${capitalized(noun)} repaired`,
      description:
        result.backups === 0
          ? `Nothing in this ${noun} needed repairing.`
          : `The engine kept a copy of what it couldn't read (${result.backups} ${result.backups === 1 ? "backup" : "backups"}).`,
    };
  }
  const why =
    result.reason === "unavailable"
      ? "The engine didn't answer. Try again in a moment."
      : result.reason === "not_found"
        ? `The engine doesn't have this ${noun} any more.`
        : `Nothing was changed: ${result.detail}.`;
  return { title: `Couldn't repair this ${noun}`, description: why, variant: "destructive" };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
