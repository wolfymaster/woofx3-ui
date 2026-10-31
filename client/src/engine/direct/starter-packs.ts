import {
  buildStarterCommand,
  buildStarterWorkflow,
  findStarterPack,
  hasRequirements,
  missingRequirements,
  requirementsMessage,
  STARTER_PACKS,
  type StarterCatalog,
  type StarterCommandItem,
  type StarterItem,
  starterFeaturesFrom,
  starterItemKey,
  validateStarterValues,
} from "@shared/starter-packs";
import { ENGINE_CAPABILITIES, type UISetting, type UISettingValue } from "@woofx3/api";
import type { WorkflowDefinition } from "@woofx3/api/workflow-definition";
import { useMemo } from "react";
import type { StarterPacksGateway } from "@/engine/gateway";
import type { StarterPackInstallOutcome, StarterPackItemState, WorkflowCatalog } from "@/engine/types";
import { groupsRead } from "./commands";
import { directKeys as k } from "./keys";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { putUISetting, UI_SETTING_NAMESPACES, uiSettingsRead } from "./ui-settings";
import { readAllWorkflows } from "./workflow-pages";
import { catalogRead, workflowsRead } from "./workflows";

// An engine does not remember which of its commands and workflows a starter
// pack made, so the dashboard keeps that ledger in the engine's UI settings:
// one setting per pack item, naming what it created. An item counts as
// installed only while that object still exists on the engine.

const MEMBER = "starterPacks.useInstallRequest";

type ItemKind = StarterItem["kind"];

interface LedgerEntry {
  kind: ItemKind;
  engineId: string;
}

function ledgerValue(entry: LedgerEntry): UISettingValue {
  return { kind: entry.kind, engineId: entry.engineId };
}

function parseLedgerEntry(setting: UISetting): LedgerEntry | null {
  const value = setting.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const { kind, engineId } = value;
  if ((kind !== "workflow" && kind !== "command") || typeof engineId !== "string") {
    return null;
  }
  return { kind, engineId };
}

/** What exists on the engine now: the ids a ledger entry may name, and the command names taken. */
interface EngineHoldings {
  workflowIds: ReadonlySet<string>;
  commandIds: ReadonlySet<string>;
  commandNames: ReadonlySet<string>;
}

function isInPlace(entry: LedgerEntry | undefined, holdings: EngineHoldings): boolean {
  if (entry === undefined) {
    return false;
  }
  return (entry.kind === "workflow" ? holdings.workflowIds : holdings.commandIds).has(entry.engineId);
}

function ledgerOf(settings: readonly UISetting[]): Map<string, LedgerEntry> {
  const ledger = new Map<string, LedgerEntry>();
  for (const setting of settings) {
    const entry = parseLedgerEntry(setting);
    if (entry !== null) {
      ledger.set(setting.key, entry);
    }
  }
  return ledger;
}

/**
 * Each item's state. A command whose name another command already has is a
 * conflict: installing it would fail, and replacing the streamer's own
 * command is not what a starter pack is for.
 */
export function starterPackStates(
  settings: readonly UISetting[],
  holdings: EngineHoldings
): Record<string, StarterPackItemState> {
  const ledger = ledgerOf(settings);
  const states: Record<string, StarterPackItemState> = {};
  for (const pack of STARTER_PACKS) {
    for (const item of pack.items) {
      const key = starterItemKey(pack.id, item.id);
      if (isInPlace(ledger.get(key), holdings)) {
        states[key] = "installed";
      } else if (item.kind === "command" && holdings.commandNames.has(item.command.toLowerCase())) {
        states[key] = "conflict";
      } else {
        states[key] = "available";
      }
    }
  }
  return states;
}

function toStarterCatalog(catalog: WorkflowCatalog): StarterCatalog {
  return {
    triggers: catalog.triggers.map(({ event, canonicalRef }) => ({ event, canonicalRef })),
    actions: catalog.actions.map(({ canonicalRef, handlerType, functionCall, configFields }) => ({
      canonicalRef,
      handlerType,
      functionCall,
      configFields,
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function directStarterPacksGateway(runtime: DirectRuntime): StarterPacksGateway {
  const ledgerRead = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.starterPacks, "starterPacks.useStatus");
  const commandsListRead = {
    queryKey: k.commands.list(),
    queryFn: () => runtime.call("listCommands", (api) => api.listCommands()),
  };

  const useStatus: StarterPacksGateway["useStatus"] = () => {
    const settings = useEngineQuery(runtime, ledgerRead);
    const commands = useEngineQuery(runtime, commandsListRead);
    const workflows = useEngineQuery(runtime, workflowsRead(runtime));
    return useMemo(() => {
      if (settings === undefined || commands === undefined || workflows === undefined) {
        return undefined;
      }
      return starterPackStates(settings, {
        workflowIds: new Set(workflows.map((workflow) => workflow.engineWorkflowId)),
        commandIds: new Set(commands.map((command) => command.id)),
        commandNames: new Set(commands.map((command) => command.command.toLowerCase())),
      });
    }, [settings, commands, workflows]);
  };

  const claimed = new Set<string>();

  const install = async ({ packId, values }: { packId: string; values: Record<string, string | number> }) => {
    const pack = findStarterPack(packId);
    if (pack === undefined) {
      throw new Error(`Unknown starter pack "${packId}"`);
    }
    const features = starterFeaturesFrom(
      runtime.supports(ENGINE_CAPABILITIES.workflowDelayWait) ? ["workflow.delayWait"] : []
    );
    const checked = validateStarterValues(pack, values, features);
    if (!checked.ok) {
      throw new Error(Object.values(checked.errors).join(" "));
    }
    const catalog = toStarterCatalog(await runtime.queryClient.fetchQuery({ ...catalogRead(runtime), staleTime: 0 }));
    const [settings, commands, groups, workflows] = await Promise.all([
      runtime.call("listUISettings", (api) => api.listUISettings(UI_SETTING_NAMESPACES.starterPacks)),
      runtime.call("listCommands", (api) => api.listCommands()),
      runtime.queryClient.fetchQuery({ ...groupsRead(runtime), staleTime: 0 }),
      readAllWorkflows(runtime),
    ]);
    const ledger = ledgerOf(settings);
    const holdings: EngineHoldings = {
      workflowIds: new Set(workflows.map((workflow) => workflow.id)),
      commandIds: new Set(commands.map((command) => command.id)),
      commandNames: new Set(commands.map((command) => command.command.toLowerCase())),
    };

    const groupIdsFor = (names: readonly string[]): string[] =>
      names.map((name) => {
        const group = groups.find((candidate) => candidate.isBuiltIn === true && candidate.name === name);
        if (group === undefined) {
          throw new Error(`The ${name} command group is not on the engine yet.`);
        }
        return group.engineGroupId;
      });

    const installCommand = async (item: StarterCommandItem): Promise<string> => {
      const built = buildStarterCommand(item, checked.values, catalog);
      const groupIds = groupIdsFor(built.restrictTo);
      const created = await runtime.call("createCommand", (api) =>
        api.createCommand({
          command: built.command,
          actions: built.actions,
          cooldown: built.cooldown,
          enabled: true,
          visibility: groupIds.length > 0 ? "restricted" : "public",
          groupIds,
          correlationKey: crypto.randomUUID(),
        })
      );
      return created.id;
    };

    const installItem = async (item: StarterItem): Promise<StarterPackInstallOutcome> => {
      const missing = missingRequirements(item, catalog);
      if (!hasRequirements(missing)) {
        return { itemId: item.id, outcome: "unavailable", message: requirementsMessage(missing) ?? undefined };
      }
      const key = starterItemKey(pack.id, item.id);
      if (isInPlace(ledger.get(key), holdings)) {
        return { itemId: item.id, outcome: "already-installed" };
      }
      if (item.kind === "command" && holdings.commandNames.has(item.command.toLowerCase())) {
        return { itemId: item.id, outcome: "conflict", message: "A command with this name already exists." };
      }
      if (claimed.has(key)) {
        return { itemId: item.id, outcome: "busy", message: "Another install of this item is in progress." };
      }
      claimed.add(key);
      try {
        const engineId =
          item.kind === "workflow"
            ? (
                await runtime.call("createWorkflow", (api) =>
                  api.createWorkflow({
                    // Carries a delay wait, which the shared WorkflowDefinition type does not model yet.
                    definition: buildStarterWorkflow(item, checked.values, catalog) as unknown as Omit<
                      WorkflowDefinition,
                      "id"
                    >,
                    correlationKey: crypto.randomUUID(),
                  })
                )
              ).id
            : await installCommand(item);
        await putUISetting(
          runtime,
          UI_SETTING_NAMESPACES.starterPacks,
          key,
          ledgerValue({ kind: item.kind, engineId }),
          MEMBER
        );
        return { itemId: item.id, outcome: "installed" };
      } catch (error) {
        return { itemId: item.id, outcome: "failed", message: errorMessage(error) };
      } finally {
        claimed.delete(key);
      }
    };

    const results: StarterPackInstallOutcome[] = [];
    for (const item of pack.items) {
      results.push(await installItem(item));
    }
    await Promise.all([
      runtime.queryClient.invalidateQueries({ queryKey: k.commands.list() }),
      runtime.queryClient.invalidateQueries({ queryKey: k.workflows.list() }),
      runtime.queryClient.invalidateQueries({ queryKey: k.workflows.health() }),
    ]);
    return results;
  };

  return {
    useStatus,
    useInstallRequest: () => useEngineRequest(install),
  };
}
