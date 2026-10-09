/**
 * A module's `list` setting travels to and from the engine as text, like
 * every module setting: a JSON array of row objects. These convert between
 * that text and what the list editor edits.
 */

/**
 * The value the list editor reads. A JSON array is its rows. Any other text is
 * handed over as it is: a setting that was text before it became a list keeps
 * its comma-separated entries, which the editor reads as rows (see
 * `listRows`), so the first save doesn't drop them.
 */
export function listSettingValue(text: string): unknown {
  if (text.trim() === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Not JSON: legacy text, read by the editor as entries.
  }
  return text;
}

/** The text saved for the rows the list editor hands back. */
export function listSettingText(rows: unknown): string {
  return JSON.stringify(Array.isArray(rows) ? rows : []);
}
