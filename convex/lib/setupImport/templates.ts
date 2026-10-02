import { argumentExpression, type EventContext, type EventField, fieldExpression } from "./events";

/**
 * Rewrites the variables in another tool's text (`$user`, `%rawInput%`) as
 * woofx3 expressions (`${trigger.data.userName}`). A variable woofx3 has no
 * value for in that context is left as written and reported, so the streamer
 * sees it in the report rather than finding it in chat.
 */
export interface TranslatedText {
  text: string;
  /** Variables left as written, exactly as they appeared. */
  unknown: string[];
}

const FIREBOT_FIELDS: Record<string, EventField> = {
  user: "user",
  username: "user",
  userdisplayname: "user",
  userid: "userId",
  chatmessage: "message",
  cheerbitsamount: "amount",
  cheermessage: "message",
  submonths: "months",
  substreak: "streak",
  subtype: "tier",
  giftcount: "amount",
  giftgiverusername: "gifter",
  rewardname: "reward",
  rewardid: "rewardId",
  rewardmessage: "message",
  raidviewercount: "viewers",
  commandtrigger: "command",
};

/** Firebot's shorthand prefixes: `$$name` custom variable, `$&name` effect output and so on. */
const FIREBOT_SHORTHANDS = new Set(["$", "&", "#", "^", "%", "!", "@"]);

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

/** The index just past the `]` closing the `[` at `open`, or -1 when it is never closed. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") {
      depth++;
    } else if (text[i] === "]") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

function firebotArgument(argument: string, context: EventContext): string | null {
  const trimmed = argument.trim();
  if (/^\d+$/.test(trimmed)) {
    return argumentExpression(context, Number(trimmed) - 1);
  }
  // `$arg[1-]` and `$arg[all]` are everything after the command word.
  if (trimmed === "all" || trimmed === "1-") {
    return fieldExpression(context, "text");
  }
  return null;
}

function firebotVariable(name: string, argument: string | null, context: EventContext): string | null {
  const lower = name.toLowerCase();
  if (lower === "arg" && argument !== null) {
    return firebotArgument(argument, context);
  }
  if (argument !== null) {
    return null;
  }
  // `$target` is the first argument with any `@` dropped; woofx3 cannot drop it,
  // and the actions that take a user resolve `@name` the same as `name`.
  if (lower === "target") {
    return argumentExpression(context, 0);
  }
  const field = FIREBOT_FIELDS[lower];
  return field === undefined ? null : fieldExpression(context, field);
}

/**
 * Translate Firebot replace variables. `presetArgs` fills `$#name` and
 * `$presetListArg[name]` when a preset effect list is inlined at its call site;
 * those values were already translated in the caller's context.
 */
export function translateFirebotText(
  text: string,
  context: EventContext,
  presetArgs: Record<string, string> = {}
): TranslatedText {
  let out = "";
  const unknown: string[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char !== "$") {
      out += char;
      i++;
      continue;
    }
    const next = text[i + 1];
    if (next !== undefined && FIREBOT_SHORTHANDS.has(next) && isIdentifierChar(text[i + 2])) {
      let end = i + 2;
      while (isIdentifierChar(text[end])) {
        end++;
      }
      const name = text.slice(i + 2, end);
      if (next === "#" && presetArgs[name] !== undefined) {
        out += presetArgs[name];
      } else {
        const token = text.slice(i, end);
        out += token;
        unknown.push(token);
      }
      i = end;
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) {
      out += char;
      i++;
      continue;
    }
    let end = i + 1;
    while (isIdentifierChar(text[end])) {
      end++;
    }
    const name = text.slice(i + 1, end);
    let argument: string | null = null;
    if (text[end] === "[") {
      const close = closingBracket(text, end);
      if (close !== -1) {
        argument = text.slice(end + 1, close - 1);
        end = close;
      }
    }
    const token = text.slice(i, end);
    if (name === "presetListArg" && argument !== null && presetArgs[argument.trim()] !== undefined) {
      out += presetArgs[argument.trim()];
    } else {
      const expression = firebotVariable(name, argument, context);
      if (expression === null) {
        out += token;
        unknown.push(token);
      } else {
        out += expression;
      }
    }
    i = end;
  }
  return { text: out, unknown };
}

const STREAMERBOT_FIELDS: Record<string, EventField> = {
  user: "user",
  username: "user",
  userlogin: "user",
  displayname: "user",
  userid: "userId",
  message: "message",
  bits: "amount",
  viewers: "viewers",
  viewercount: "viewers",
  rewardname: "reward",
  rewardid: "rewardId",
  cumulative: "months",
  monthstreak: "streak",
  tier: "tier",
  gifts: "amount",
  command: "command",
};

function streamerbotVariable(name: string, context: EventContext): string | null {
  const lower = name.toLowerCase();
  const input = /^input(\d+)$/.exec(lower);
  if (input) {
    return argumentExpression(context, Number(input[1]));
  }
  // Everything after the command word on a command; the message itself on a
  // chat message or a reward's text.
  if (lower === "rawinput") {
    return fieldExpression(context, "text") ?? fieldExpression(context, "message");
  }
  const field = STREAMERBOT_FIELDS[lower];
  return field === undefined ? null : fieldExpression(context, field);
}

/** `%name%` or `%name:format%`, a persisted global `~name~`, or an inline function `$math(...)$`. */
const STREAMERBOT_TOKEN = /%([A-Za-z_][A-Za-z0-9_.]*)(?::[^%\s]*)?%|~[A-Za-z_][A-Za-z0-9_.]*~|\$[a-z]+\([^)]*\)\$/g;

export function translateStreamerbotText(text: string, context: EventContext): TranslatedText {
  const unknown: string[] = [];
  const out = text.replace(STREAMERBOT_TOKEN, (token: string, name: string | undefined) => {
    const expression = name === undefined ? null : streamerbotVariable(name, context);
    if (expression === null) {
      unknown.push(token);
      return token;
    }
    return expression;
  });
  return { text: out, unknown };
}

/** The report note for variables a translation left as written. */
export function unknownVariablesMessage(unknown: readonly string[]): string {
  const distinct = Array.from(new Set(unknown));
  const list = distinct.join(", ");
  return distinct.length === 1
    ? `Uses ${list}, which woofx3 has no value for here, so it is sent as written.`
    : `Uses ${list}, which woofx3 has no values for here, so they are sent as written.`;
}
