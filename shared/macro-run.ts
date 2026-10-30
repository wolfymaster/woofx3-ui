// Running a macro: what a press with these variable values asks the engine to
// do, and the engine calls that carry it out. Pure and shared, so Convex (a
// dashboard press or a remote trigger) and the desktop app's own engine run a
// macro the same way.

import type { ActionStep, RunActionsInput } from "@woofx3/api";
import { unescapeDollarKeys } from "./dollar-keys";
import {
  applyMacroVariables,
  extractMacroVariables,
  type MacroActionStep,
  type MacroActionType,
  type MacroConfig,
} from "./macro-variables";

// A newline in a value would let one `{{var}}` smuggle a second line into a
// chat command, and the other control characters have no business in one.
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Shown to members, who may not run chat-command macros from the dashboard (see macros.run). */
export const CHAT_COMMAND_RUN_RESTRICTION = "Only owners and admins can run chat-command macros from the dashboard";

export type MacroRunPlan =
  | { kind: "trigger-workflow"; workflowNameOrId: string }
  | { kind: "chat-command"; commandName: string; text: string }
  // The step stays in its stored form (no `$` keys) because a plan crosses
  // Convex function boundaries; macroActionToEngineStep converts it for the engine.
  | { kind: "run-action"; step: MacroActionStep };

export type PlanResult = { ok: true; plan: MacroRunPlan } | { ok: false; status: 400 | 422; error: string };

/**
 * `!name rest of line` split into the command word and the text after it,
 * which is what the engine's executeCommand takes. Null for anything that is
 * not a `!command`: the engine has no way to post a plain chat message.
 */
export function parseChatCommand(command: string): { commandName: string; text: string } | null {
  const match = /^!(\S+)(?:\s+([\s\S]*))?$/.exec(command.trim());
  if (!match) {
    return null;
  }
  return { commandName: match[1], text: (match[2] ?? "").trim() };
}

/**
 * The command a chat-command macro runs. A button saved from the command
 * picker holds the bare word in `command` and its arguments in `commandText`;
 * an older button holds one typed `!word rest` line in `command`, which must
 * start with `!` so plain chat text is never run as a command.
 */
export function chatCommandFromConfig(config: MacroConfig): { commandName: string; text: string } | null {
  if (config.commandText === undefined) {
    return parseChatCommand(config.command ?? "");
  }
  const commandName = (config.command ?? "").trim().replace(/^!/, "");
  if (!/^\S+$/.test(commandName)) {
    return null;
  }
  return { commandName, text: config.commandText.trim() };
}

/** The engine's ActionStep for a stored macro action, with its `$` keys restored. */
export function macroActionToEngineStep(stored: MacroActionStep): ActionStep {
  const step: ActionStep = {
    action: stored.action,
    parameters: unescapeDollarKeys(stored.parameters ?? {}) as Record<string, unknown>,
  };
  if (stored.function) {
    step.function = stored.function;
  }
  if (stored.ref) {
    step.$ref = stored.ref;
  }
  return step;
}

/**
 * The variables the macro needs that `values` does not supply. Blank counts
 * as missing: an empty `{{channel}}` would send a half-built command.
 */
export function missingMacroVariables(config: MacroConfig, values: Readonly<Record<string, string>>): string[] {
  return extractMacroVariables(config).filter((name) => (values[name] ?? "").trim() === "");
}

/**
 * What running this macro with these variable values asks the engine to do,
 * or why it cannot run. Shared by the dashboard's run action and the remote
 * trigger route, so a button press and a Stream Deck press do the same thing.
 *
 * HTTP-request macros are refused: they are fetched from the viewer's browser,
 * where a local target (OBS, a LAN device) is reachable. Running one from
 * Convex would reach a different network and make Convex a proxy that sends
 * the macro's stored headers to any URL.
 */
export function planMacroRun(
  type: MacroActionType,
  config: MacroConfig,
  values: Readonly<Record<string, string>>
): PlanResult {
  if (type === "http-request") {
    return {
      ok: false,
      status: 422,
      error:
        "HTTP request macros run in the browser and cannot be triggered remotely; point the device at that URL directly",
    };
  }
  if (type === "send-message") {
    return {
      ok: false,
      status: 422,
      error: "send message macros post from the dashboard and cannot be triggered remotely",
    };
  }

  const missing = missingMacroVariables(config, values);
  if (missing.length > 0) {
    return { ok: false, status: 400, error: `missing variables: ${missing.join(", ")}` };
  }
  const tainted = extractMacroVariables(config).filter((name) => hasControlCharacter(values[name] ?? ""));
  if (tainted.length > 0) {
    return { ok: false, status: 400, error: `control characters are not allowed in: ${tainted.join(", ")}` };
  }
  const resolved = applyMacroVariables(config, values);

  if (type === "trigger-workflow") {
    const workflowNameOrId = resolved.workflowId?.trim() ?? "";
    if (workflowNameOrId === "") {
      return { ok: false, status: 422, error: "this macro has no workflow selected" };
    }
    return { ok: true, plan: { kind: "trigger-workflow", workflowNameOrId } };
  }

  if (type === "run-action") {
    if (!resolved.actionStep || resolved.actionStep.action.trim() === "") {
      return { ok: false, status: 422, error: "this macro has no action selected" };
    }
    return { ok: true, plan: { kind: "run-action", step: resolved.actionStep } };
  }

  const parsed = chatCommandFromConfig(resolved);
  if (!parsed) {
    return { ok: false, status: 422, error: "this macro's command must start with ! followed by the command name" };
  }
  return { ok: true, plan: { kind: "chat-command", ...parsed } };
}

/** Why a chat-command macro cannot run: it runs as the linked broadcaster. */
export const MACRO_NEEDS_TWITCH_LINK = "link a Twitch account before running chat-command macros";

/**
 * The engine's `runActions` request for a planned action macro. The engine
 * records no run and reports no lifecycle for actions outside a workflow, so
 * the press has no outcome to watch.
 */
export function macroRunActionsInput(step: MacroActionStep, triggeredBy: string): RunActionsInput {
  return {
    label: `macro:${triggeredBy}`,
    actions: [macroActionToEngineStep(step)],
    event: { type: "macro.run", source: triggeredBy, data: {} },
  };
}

/** What a caller is told when the engine answers a chat-command macro's `executeCommand` with a refusal. */
export function macroCommandRefusal(commandName: string, engineMessage: string): string {
  return engineMessage || `the engine refused "!${commandName}"`;
}
