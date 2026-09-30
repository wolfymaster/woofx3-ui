import type { ComponentType } from "react";
import type { PaletteEntry } from "@/lib/command-palette";

/**
 * What a command's run resolves to: a line for the confirmation toast, or nothing when the
 * result shows for itself (a counter's new value, a page opening).
 */
export type RunResult = string | undefined;

/** Asks for one line of text, then runs with it — a chat message, a login to shout out. */
export interface PalettePrompt {
  placeholder: string;
  /** Label of the row that submits, given what has been typed so far. */
  submitLabel: (text: string) => string;
  /** Words that, typed before an argument on the root list ("so ninja"), fill the prompt in place. */
  aliases?: readonly string[];
  /** Whether submitting nothing is meaningful, as with a stream marker's optional description. */
  allowEmpty?: boolean;
  run: (text: string) => Promise<RunResult>;
}

export type PaletteAction =
  | { type: "navigate"; href: string }
  /** `keepOpen` suits actions repeated in a row, like stepping a counter. */
  | { type: "run"; run: () => Promise<RunResult>; keepOpen?: boolean }
  /** Opens a nested list, e.g. an item's own actions. */
  | { type: "menu"; children: PaletteCommand[]; placeholder?: string }
  | { type: "prompt"; prompt: PalettePrompt };

export interface PaletteCommand extends PaletteEntry {
  icon: ComponentType<{ className?: string }>;
  action: PaletteAction;
  /**
   * What can be done to this item besides its action, opened with Tab: a workflow's
   * enable toggle, a counter's reset. Also searchable from the root list.
   */
  children?: PaletteCommand[];
  /** Asks for a second Enter before running, for what cannot be undone. */
  confirm?: boolean;
  /** Short state shown on the right, e.g. a counter's value or "Disabled". */
  meta?: string;
  /**
   * Whether this item is what the page at `path` shows. The palette then lists the item's
   * own actions first while that page is open, so the thing on screen is one keystroke away.
   */
  isOpenAt?: (path: string) => boolean;
}
