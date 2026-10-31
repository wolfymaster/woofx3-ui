import {
  compareMacroOrder,
  type MacroFields,
  macroFieldsProblem,
  macroOrderChanges,
  nextMacroSortOrder,
} from "@shared/macro-pad";
import {
  MACRO_NEEDS_TWITCH_LINK,
  type MacroRunPlan,
  macroCommandRefusal,
  macroRunActionsInput,
  planMacroRun,
  valuesFromPairs,
} from "@shared/macro-run";
import type { MacroConfig } from "@shared/macro-variables";
import { UNRECORDED_ORIGIN } from "@shared/manual-run-origin";
import type { UISetting, UISettingValue } from "@woofx3/api";
import { z } from "zod";
import type { MacrosGateway } from "@/engine/gateway";
import type { Macro, MacroId, MacroInput, MacroRunResult, MacroVariableValue } from "@/engine/types";
import type { Logger } from "@/lib/engine-session/deps";
import { fromMacroId, toMacroId } from "./ids";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";
import {
  removeUISetting,
  UI_SETTING_NAMESPACES,
  type UISettingUpdate,
  uiSettingsRead,
  updateUISetting,
} from "./ui-settings";

// The macro pad in the engine's local UI settings: one key per macro, its id,
// holding the macro's fields and its place on the pad (`sortOrder`). One key
// per macro rather than one list, so an edit, a delete and a reorder each
// write only the macros they touch, and two windows editing different
// buttons never conflict.
//
// The engine stores values it never reads, so whatever comes back is checked
// against the schema below. A value that fails is left off the pad (a logged
// warning, not a broken dashboard).

const NOT_FOUND = "Macro not found";
const NO_TWITCH_LOGIN = "the engine could not read the linked Twitch account's login; try again once Twitch answers";

const actionStepSchema = z.object({
  action: z.string(),
  function: z.string().optional(),
  ref: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});

const macroConfigSchema: z.ZodType<MacroConfig> = z.object({
  message: z.string().optional(),
  command: z.string().optional(),
  commandText: z.string().optional(),
  workflowId: z.string().optional(),
  url: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  actionStep: actionStepSchema.optional(),
});

const storedMacroSchema = z.object({
  label: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  type: z.enum(["send-message", "chat-command", "trigger-workflow", "http-request", "run-action"]),
  config: macroConfigSchema,
  sortOrder: z.number(),
});

type StoredMacro = z.infer<typeof storedMacroSchema>;

/** A macro as read back, with the key it is stored under. */
interface PadEntry {
  id: string;
  stored: StoredMacro;
}

/** `value` without its undefined fields, which JSON cannot hold. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/**
 * What a macro's key holds. Built from typed fields of plain values and
 * config the caller's schema allows, so JSON can represent it.
 */
function toStoredValue({ label, icon, color, type, config }: MacroFields, sortOrder: number): UISettingValue {
  const stored: StoredMacro = withoutUndefined({
    label,
    icon,
    color,
    type,
    config: withoutUndefined(config),
    sortOrder,
  });
  return stored as unknown as UISettingValue;
}

function write(fields: MacroFields, sortOrder: number): UISettingUpdate {
  return { kind: "write", value: toStoredValue(fields, sortOrder) };
}

function toMacro({ id, stored }: PadEntry): Macro {
  return {
    id: toMacroId(id),
    label: stored.label,
    icon: stored.icon,
    color: stored.color,
    type: stored.type,
    config: stored.config,
  };
}

/** Refuses fields no store of the pad would save, before anything is written. */
function requireStorable(input: MacroInput): MacroFields {
  const problem = macroFieldsProblem(input);
  if (problem !== null) {
    throw new Error(problem);
  }
  const parsed = macroConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    throw new Error(`A macro's settings do not fit: ${parsed.error.issues[0]?.message ?? "unknown problem"}`);
  }
  return { label: input.label, icon: input.icon, color: input.color, type: input.type, config: parsed.data };
}

function parseStored(logger: Logger, setting: UISetting): StoredMacro | null {
  const parsed = storedMacroSchema.safeParse(setting.value);
  if (!parsed.success) {
    logger.warn("Direct macros: a stored macro is unreadable and is left off the pad", {
      namespace: setting.namespace,
      key: setting.key,
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}

export function directMacrosGateway(runtime: DirectRuntime): MacrosGateway {
  const { logger } = runtime;
  const { macros: namespace } = UI_SETTING_NAMESPACES;
  const twitch = directTwitch(runtime);
  const padRead = uiSettingsRead(runtime, namespace, "macros.useMacros");

  const padEntries = (settings: UISetting[]): PadEntry[] =>
    settings
      .flatMap((setting) => {
        const stored = parseStored(logger, setting);
        return stored ? [{ id: setting.key, stored }] : [];
      })
      .sort((a, b) => compareMacroOrder({ id: a.id, ...a.stored }, { id: b.id, ...b.stored }));

  // Built once per gateway so the cached read is derived again only when the namespace changes.
  const selectMacros = (settings: UISetting[]): Macro[] => padEntries(settings).map(toMacro);

  const readPad = async (member: string): Promise<PadEntry[]> => {
    return padEntries(await runtime.queryClient.fetchQuery(uiSettingsRead(runtime, namespace, member)));
  };

  const add = async (input: MacroInput): Promise<MacroId> => {
    const member = "macros.useAddRequest";
    const fields = requireStorable(input);
    const sortOrder = nextMacroSortOrder((await readPad(member)).map((entry) => entry.stored.sortOrder));
    const id = runtime.newId();
    await updateUISetting(runtime, namespace, id, () => write(fields, sortOrder), member);
    return toMacroId(id);
  };

  const update = async (macroId: MacroId, input: MacroInput): Promise<void> => {
    const member = "macros.useUpdateRequest";
    const fields = requireStorable(input);
    await updateUISetting(
      runtime,
      namespace,
      fromMacroId(macroId),
      (current) => {
        const stored = current && parseStored(logger, current);
        if (!stored) {
          throw new Error(NOT_FOUND);
        }
        return write(fields, stored.sortOrder);
      },
      member
    );
  };

  const remove = (macroId: MacroId) =>
    removeUISetting(runtime, namespace, fromMacroId(macroId), "macros.useDeleteRequest");

  /** Shows `changes` in the cached pad at once, so a dragged tile does not spring back while they are written. */
  const showOrder = (changes: ReadonlyMap<string, number>): void => {
    runtime.queryClient.setQueryData<UISetting[]>(padRead.queryKey, (settings) =>
      settings?.map((setting) => {
        const sortOrder = changes.get(setting.key);
        if (sortOrder === undefined || setting.value === null || typeof setting.value !== "object") {
          return setting;
        }
        return { ...setting, value: { ...setting.value, sortOrder } };
      })
    );
  };

  const reorder = async (macroIds: MacroId[]): Promise<void> => {
    const member = "macros.useReorderRequest";
    const pad = await readPad(member);
    const current = new Map(pad.map((entry) => [entry.id, entry.stored.sortOrder]));
    const changes = macroOrderChanges(macroIds.map(fromMacroId), current);
    showOrder(new Map(changes.map((change) => [change.id, change.sortOrder])));
    try {
      for (const { id, sortOrder } of changes) {
        // A macro deleted or made unreadable since the pad was read is left as it is.
        await updateUISetting(
          runtime,
          namespace,
          id,
          (setting) => {
            const stored = setting && parseStored(logger, setting);
            return stored ? write(stored, sortOrder) : { kind: "keep" };
          },
          member
        );
      }
    } catch (error) {
      await runtime.queryClient.invalidateQueries({ queryKey: padRead.queryKey });
      throw error;
    }
  };

  const execute = async (plan: MacroRunPlan): Promise<MacroRunResult> => {
    if (plan.kind === "trigger-workflow") {
      // Minted before the call, so a caller can watch for the outcome before the run exists.
      const triggerId = runtime.newId();
      await runtime.call("triggerWorkflowByName", (api) =>
        api.triggerWorkflowByName(plan.workflowNameOrId, {}, undefined, triggerId, UNRECORDED_ORIGIN)
      );
      return { triggerId };
    }
    if (plan.kind === "run-action") {
      await runtime.call("runActions", (api) => api.runActions(macroRunActionsInput(plan.step, UNRECORDED_ORIGIN)));
      return { triggerId: null };
    }
    // A chat-command macro runs as the broadcaster, as if they had typed it.
    const link = await runtime.queryClient.fetchQuery(twitch.linkRead);
    if (!link.linked) {
      throw new Error(MACRO_NEEDS_TWITCH_LINK);
    }
    const login = link.login;
    if (login === null) {
      throw new Error(NO_TWITCH_LOGIN);
    }
    const result = await runtime.call("executeCommand", (api) =>
      api.executeCommand(plan.commandName, login, plan.text)
    );
    if (!result.success) {
      throw new Error(macroCommandRefusal(plan.commandName, result.message));
    }
    return { triggerId: null };
  };

  // One computer is one viewer, its streamer, so nothing on the pad is held back by role.
  const run = async (macroId: MacroId, values: MacroVariableValue[]): Promise<MacroRunResult> => {
    const id = fromMacroId(macroId);
    const entry = (await readPad("macros.useRunRequest")).find((candidate) => candidate.id === id);
    if (!entry) {
      throw new Error(NOT_FOUND);
    }
    const planned = planMacroRun(entry.stored.type, entry.stored.config, valuesFromPairs(values));
    if (!planned.ok) {
      throw new Error(planned.error);
    }
    return execute(planned.plan);
  };

  return {
    useMacros: () => useEngineQuery(runtime, padRead, { select: selectMacros }),
    useAddRequest: () => useEngineRequest(add),
    useUpdateRequest: () => useEngineRequest(update),
    useDeleteRequest: () => useEngineRequest(remove),
    useReorderRequest: () => useEngineRequest(reorder),
    useRunRequest: () => useEngineRequest(run),
  };
}
