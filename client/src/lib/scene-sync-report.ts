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
        description: clauses.length === 0 ? "It was deleted." : `It was deleted, so ${joinList(clauses)}.`,
      };
    case "closed":
      if (clauses.length === 0) {
        return {
          title: "The scene editor disconnected",
          description: `The editor for ${scene} lost its connection. Open the scene again to keep editing.`,
        };
      }
      return {
        title: "Your last changes may not have been saved",
        description: `The editor for ${scene} closed before everything was saved: ${joinList(
          clauses
        )}. Open the scene to check it.`,
      };
    case "rejected": {
      const command = report.items.find(isCommand);
      if (command !== undefined && report.items.length === 1) {
        return {
          title: `${COMMAND_NAME[command.kind]} didn't go through`,
          description: `Couldn't ${command.kind} the draft of ${scene}. Try again.`,
        };
      }
      return {
        title: "This change couldn't be saved",
        description: `A change to ${scene} was undone in the editor. Try again.`,
      };
    }
    case "history_lost":
      return {
        title: "Some recent changes were lost",
        description: `woofx3 restarted before saving the last changes to ${scene}, so the editor shows it as last saved. Check it and redo anything missing.`,
      };
  }
}
