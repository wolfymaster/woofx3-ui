/**
 * The single field a command is typed into, and the two values the engine stores.
 *
 * Everything up to the first space is the command word; everything after is the
 * argumentPattern (e.g. "sr {songTitle}" -> command "sr", pattern "{songTitle}").
 * See CommandSnapshot.argumentPattern in @woofx3/api for the extraction rule the
 * engine applies at chat-message time.
 */
export function splitCommandInput(raw: string): { command: string; argumentPattern: string } {
  // The field wraps long commands over several lines; the stored command is always one line.
  const trimmed = raw
    .replace(/[\r\n]+/g, "")
    .trim()
    .replace(/^!/, "");
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed, argumentPattern: "" };
  }
  return {
    command: trimmed.slice(0, spaceIndex),
    argumentPattern: trimmed.slice(spaceIndex + 1).trim(),
  };
}

export function joinCommandInput(command: string, argumentPattern: string): string {
  return argumentPattern ? `${command} ${argumentPattern}` : command;
}
