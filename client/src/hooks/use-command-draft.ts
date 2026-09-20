import type { Doc } from "@convex/_generated/dataModel";
import type { ActionStep } from "@woofx3/api";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  type CommandDraft,
  type CommandEditorState,
  emptyCommand,
  getCommandDraft,
  NEW_COMMAND_KEY,
  setCommandDraft,
  subscribeToCommandDrafts,
} from "@/lib/command-drafts";
import { joinCommandInput } from "@/lib/command-input";
import { unescapeDollarKeys } from "@/lib/dollar-keys";

/** The draft for one command, re-rendering whenever any draft changes. See lib/command-drafts.ts. */
export function useCommandDraft(key: string): CommandDraft | undefined {
  const getSnapshot = useCallback(() => getCommandDraft(key), [key]);
  return useSyncExternalStore(subscribeToCommandDrafts, getSnapshot);
}

/**
 * The command's draft, opened from the engine's copy when there isn't one yet. Shared by
 * the command editor and the alert editor a step opens, so a deep link straight to the
 * alert editor builds the same draft the command editor would have.
 *
 * `doc` is undefined for a command being created, and until the command list has loaded.
 * A draft already open is left alone: it holds edits in progress, which a list refreshed
 * by a webhook must not overwrite.
 */
export function useOpenCommandDraft(key: string, doc: Doc<"chatCommands"> | undefined): CommandDraft | undefined {
  const draft = useCommandDraft(key);

  useEffect(() => {
    if (getCommandDraft(key)) {
      return;
    }
    if (key === NEW_COMMAND_KEY) {
      setCommandDraft(key, { value: emptyCommand, baseline: JSON.stringify(emptyCommand) });
      return;
    }
    if (doc) {
      const value = commandEditorState(doc);
      setCommandDraft(key, { value, baseline: JSON.stringify(value) });
    }
  }, [key, doc]);

  return draft;
}

/** The engine's copy of a command, in the shape the editor works in. */
export function commandEditorState(doc: Doc<"chatCommands">): CommandEditorState {
  return {
    command: joinCommandInput(doc.command, doc.argumentPattern ?? ""),
    actions: unescapeDollarKeys(doc.actions ?? []) as ActionStep[],
    cooldown: doc.cooldown,
    priority: doc.priority,
    enabled: doc.enabled,
    visibility: doc.visibility,
    groupIds: doc.groupIds,
    usernames: doc.usernames,
  };
}
