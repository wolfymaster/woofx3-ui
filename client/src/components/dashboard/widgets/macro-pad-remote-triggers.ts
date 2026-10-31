import type { ComponentType } from "react";
import type { Macro } from "@/engine/types";

/**
 * What the macro pad shows of remote trigger URLs, which only the hosted app
 * serves: each triggered macro's status, the editor's trigger section, and
 * the viewer's role, read alongside them. The pad works without any of it.
 */
export interface MacroPadRemoteTriggers {
  /**
   * Whether the viewer is an owner or admin, who alone may run a
   * chat-command macro or change what a triggered macro does; undefined
   * until known, when the pad leaves buttons enabled and the store refuses
   * what the role does not allow.
   */
  canManage: boolean | undefined;
  /** The status line of each macro that has a trigger, by macro id. */
  statuses: Readonly<Record<string, string>>;
  /** The editor's trigger section for a saved macro; null where trigger URLs are not served. */
  EditorSection: ComponentType<{ macro: Macro }> | null;
}

const NO_REMOTE_TRIGGERS: MacroPadRemoteTriggers = { canManage: true, statuses: {}, EditorSection: null };

/** For a pad with no trigger URLs, such as one viewer on their own engine, who manages everything on it. */
export function useNoRemoteTriggers(): MacroPadRemoteTriggers {
  return NO_REMOTE_TRIGGERS;
}
