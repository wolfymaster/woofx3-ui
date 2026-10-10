import type { ReportItem, SyncReport } from "@woofx3/api/scene-editor/client";

/**
 * What a toast says about a `SyncReport` from the scene editor's sync client.
 * It names the scene, as the report may arrive after the editor closed, when
 * another scene may be open.
 */
export interface ReportToast {
  title: string;
  description: string;
}

const COMMAND_NAME = { publish: "Publish", discard: "Discard" } as const;

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

type CommandItem = Extract<ReportItem, { kind: "publish" | "discard" }>;

function isCommand(item: ReportItem): item is CommandItem {
  return item.kind !== "edits";
}

/** One undelivered item, as a clause. */
function itemClause(item: ReportItem): string {
  if (item.kind === "edits") {
    const target = item.version === "draft" ? "changes to the draft" : "live changes";
    return item.sent ? `${target} may not have been saved` : `${target} weren't saved`;
  }
  const name = COMMAND_NAME[item.kind];
  return item.maybeRan ? `${name} may have gone through` : `${name} wasn't sent`;
}

function sceneLabel(sceneName: string | undefined): string {
  return sceneName ? `"${sceneName}"` : "the scene";
}

export function syncReportToast(report: SyncReport, sceneName: string | undefined): ReportToast {
  const scene = sceneLabel(sceneName);
  const clauses = report.items.map(itemClause);
  switch (report.reason) {
    case "gone":
      return {
        title: `${capitalize(scene)} no longer exists`,
        description:
          clauses.length === 0
            ? "The scene manager doesn't have it any more."
            : `The scene manager doesn't have it any more, so ${joinList(clauses)}.`,
      };
    case "closed":
      if (clauses.length === 0) {
        return {
          title: "The scene editor disconnected",
          description: `The editor for ${scene} lost its connection to the scene manager${
            report.detail ? ` (${report.detail})` : ""
          }. Open the scene again to keep editing.`,
        };
      }
      return {
        title: "Your last changes may not have been saved",
        description: `The editor for ${scene} closed before the scene manager confirmed everything: ${joinList(
          clauses
        )}. Open the scene to check it.`,
      };
    case "rejected": {
      const reason = report.detail ? `: ${report.detail}.` : ".";
      const command = report.items.find(isCommand);
      if (command !== undefined && report.items.length === 1) {
        return {
          title: `${COMMAND_NAME[command.kind]} didn't go through`,
          description: `The scene manager refused to ${command.kind} the draft of ${scene}${reason}`,
        };
      }
      return {
        title: "This change couldn't be saved",
        description: `The scene manager refused a change to ${scene}${reason} It was undone in the editor.`,
      };
    }
    case "history_lost":
      return {
        title: "The scene manager lost recent changes",
        description: `It restarted before saving the last changes to ${scene}, so the editor now shows the scene as the scene manager has it. Check it and redo anything missing.`,
      };
  }
}
