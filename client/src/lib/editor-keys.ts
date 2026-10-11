/**
 * Whether a key press belongs to the canvas editor rather than to whatever
 * has focus. The editor listens on the window, so the same keys that nudge
 * and delete widgets also reach text fields, menus and the layers list's
 * sortable grips; those keep their keys.
 */

import type { CompositionEditor, KeyInput } from "@woofx3/scene/editor";

/** The parts of a DOM element this reads; an `Element` has all of them. */
export interface KeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Elements whose keys are their own: an open dialog, popover or menu
 * (Radix gives each a role), a listbox, and a dnd-kit sortable grip, which
 * moves its layer with the arrow keys.
 */
const OWN_KEYS_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"], [aria-roledescription="sortable"]';

/** The parts of a key event `sendKeyToEditor` reads; a DOM `KeyboardEvent` has all of them. */
export interface EditorKeyEvent extends KeyInput {
  target: unknown;
  defaultPrevented: boolean;
  isComposing: boolean;
}

/**
 * Hand a key press to the editor when it is the editor's to take, and say
 * whether the editor used it. Only a used key should have its default
 * prevented: one the editor had nothing to do with (an arrow with nothing
 * selected, undo with nothing to undo, an edit while read-only) goes on to
 * the browser, which scrolls the page with it.
 */
export function sendKeyToEditor(editor: Pick<CompositionEditor, "handleKey">, event: EditorKeyEvent): boolean {
  if (event.defaultPrevented || event.isComposing) {
    return false;
  }
  if (!isEditorKeyTarget(event.target as KeyTargetLike | null)) {
    return false;
  }
  return editor.handleKey(event);
}

export function isEditorKeyTarget(target: KeyTargetLike | null): boolean {
  if (target === null) {
    return true;
  }
  if (target.isContentEditable === true) {
    return false;
  }
  if (typeof target.tagName === "string" && TYPING_TAGS.has(target.tagName.toUpperCase())) {
    return false;
  }
  if (typeof target.closest === "function" && target.closest(OWN_KEYS_SELECTOR) !== null) {
    return false;
  }
  return true;
}
