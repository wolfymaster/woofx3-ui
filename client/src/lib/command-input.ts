import { argumentNames } from "@/lib/command-variables";

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

// A leading "!" keeps a pattern attached to an empty word: splitCommandInput drops the "!" but
// not the space after it, whereas a bare leading space would be trimmed and the capture read as the word.
function buildCommandInput(word: string, argumentPattern: string): string {
  return word || !argumentPattern ? joinCommandInput(word, argumentPattern) : `! ${argumentPattern}`;
}

/** The stored command with its word replaced; spaces are dropped because a space would end the word. */
export function withCommandWord(raw: string, word: string): string {
  return buildCommandInput(word.replace(/\s+/g, "").replace(/^!+/, ""), splitCommandInput(raw).argumentPattern);
}

export type CommandInputResult = { ok: true; command: string } | { ok: false; error: string };

/**
 * Turns what a streamer types ("song title") into the capture name the engine stores
 * ("songTitle"): words are joined camelCase and anything outside letters, digits, "_" and "." goes.
 */
export function inputNameFromLabel(label: string): string {
  const words = label.split(/[^A-Za-z0-9_.]+/).filter((word) => word !== "");
  return words
    .map((word, index) => (index === 0 ? word[0].toLowerCase() + word.slice(1) : word[0].toUpperCase() + word.slice(1)))
    .join("");
}

/** Adds a `{name}` capture after the command's existing pattern, refusing an empty or repeated name. */
export function addCommandInput(raw: string, label: string): CommandInputResult {
  const name = inputNameFromLabel(label);
  if (!name) {
    return { ok: false, error: "Use letters or numbers, like song title." };
  }
  const { command, argumentPattern } = splitCommandInput(raw);
  if (argumentNames(argumentPattern).includes(name)) {
    return { ok: false, error: `You already have an input called ${name}.` };
  }
  const pattern = argumentPattern ? `${argumentPattern} {${name}}` : `{${name}}`;
  return { ok: true, command: buildCommandInput(command, pattern) };
}

/** Removes every `{name}` capture, leaving any other words of the pattern in place. */
export function removeCommandInput(raw: string, name: string): string {
  const { command, argumentPattern } = splitCommandInput(raw);
  const pattern = argumentPattern
    .split(`{${name}}`)
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
  return buildCommandInput(command, pattern);
}
