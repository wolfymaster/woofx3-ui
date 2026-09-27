/**
 * Elements that act on their own when clicked. A click that starts inside one belongs to
 * that control, so a clickable table row must not also act on it. Checking the target
 * here, rather than stopping propagation on each control, keeps a control added to the
 * row later from navigating by accident.
 */
export const ROW_CONTROL_SELECTOR = "button, a, input, select, textarea, label, [role='switch']";

/** The part of a click's target this check needs; satisfied by any DOM `Element`. */
export interface ClickTarget {
  closest(selector: string): unknown;
}

/**
 * Whether a click on a clickable table row should run the row's own action.
 *
 * Not when the click started inside one of the row's controls, and not when the user
 * has just selected text: people copy a name out of the table, and the mouseup that
 * ends the selection arrives as a click on the row.
 */
export function isRowActionClick(target: ClickTarget | null, selectedText: string): boolean {
  if (target === null) {
    return false;
  }
  if (target.closest(ROW_CONTROL_SELECTOR)) {
    return false;
  }
  return selectedText.length === 0;
}
