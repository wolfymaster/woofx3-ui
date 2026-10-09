import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";
import { useAction, useQuery } from "convex/react";
import {
  Bell,
  FlaskConical,
  FolderTree,
  History,
  Layers,
  ListOrdered,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  Puzzle,
  RotateCcw,
  SkipForward,
  SquareTerminal,
  Tally5,
  Timer,
  Trash2,
  Tv,
  Workflow,
  Zap,
} from "lucide-react";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import { useResourceActionRunner } from "@/hooks/use-resource-action";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { buildAlertTree, flattenAlertTree } from "@/lib/alert-groups";
import { commandEditorPath, commandGroupEditorPath } from "@/lib/command-editor-route";
import { groupLabel } from "@/lib/group-display";
import { applyMacroVariables, hasMacroVariables } from "@/lib/macro-pad";
import { bareModuleKey } from "@/lib/module-key";
import { type ResourceInstanceDoc, resourceName, resourceSettings } from "@/lib/resource-instance";
import { counterValue, formatDuration, parseDuration, queueEntries, timerState } from "@/lib/resource-values";
import { streamRecapPath } from "@/lib/stream-recap-route";
import { initialValues, payloadFromValues, testEventFields } from "@/lib/test-event-fields";
import { workflowDescription, workflowName } from "@/lib/workflow-display";
import { workflowRunsPath } from "@/lib/workflow-run-route";
import type { PaletteCommand } from "./types";

/** Whether `path` is `base` or somewhere below it. */
function isAtOrBelow(base: string) {
  return (path: string) => path === base || path.startsWith(`${base}/`);
}

/** Actions nested under an item: listed under it, and found by search from the root. */
function childOf(parent: Pick<PaletteCommand, "id" | "title" | "group">, child: Omit<PaletteCommand, "group">) {
  return {
    ...child,
    id: `${parent.id}:${child.id}`,
    group: parent.group,
    subtitle: child.subtitle ?? parent.title,
    hiddenUntilSearch: true,
  } satisfies PaletteCommand;
}

const RECAP_DATE: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" };

const RECENT_RECAPS = 10;

/**
 * Everything on the instance a user might look for by name, each with its own actions.
 * Queries only run while the palette is open, since this hook lives in its content.
 */
export function useItemCommands(instance: Doc<"instances"> | null): PaletteCommand[] {
  const instanceId = instance?._id;
  const args = instanceId ? { instanceId } : "skip";

  const workflows = useQuery(api.workflows.list, args);
  const commands = useQuery(api.chatCommands.list, args);
  const commandGroups = useQuery(api.chatCommandGroups.list, args);
  const scenes = useQuery(api.scenes.list, args);
  const modules = useQuery(api.moduleRepository.list, args);
  const recaps = useQuery(
    api.streamSessionSummaries.listRecent,
    instanceId ? { instanceId, limit: RECENT_RECAPS } : "skip"
  );
  const macros = useQuery(api.macros.list, args);
  const presets = useQuery(api.streamInfo.listPresets, args);
  const counters = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId ? { instanceId, kind: COUNTER_KIND } : "skip"
  );
  const timers = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId ? { instanceId, kind: TIMER_KIND } : "skip"
  );
  const queues = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId ? { instanceId, kind: QUEUE_KIND } : "skip"
  );
  const counterKind = useQuery(
    api.resourceKinds.getForInstance,
    instanceId ? { instanceId, kind: COUNTER_KIND } : "skip"
  );
  const timerKind = useQuery(api.resourceKinds.getForInstance, instanceId ? { instanceId, kind: TIMER_KIND } : "skip");
  const queueKind = useQuery(api.resourceKinds.getForInstance, instanceId ? { instanceId, kind: QUEUE_KIND } : "skip");
  const values = useQuery(api.resourceValues.listForInstance, args);
  const { triggerPresets } = useWorkflowCatalog();

  const setWorkflowEnabled = useAction(api.workflowActions.setEnabled);
  const updateCommand = useAction(api.chatCommandActions.updateCommand);
  const runMacro = useAction(api.macros.run);
  const sendChatMessage = useAction(api.twitchBroadcast.sendChatMessage);
  const updateChannelInfo = useAction(api.streamInfo.updateChannelInfo);
  const runResourceAction = useResourceActionRunner();
  const fireTestEvent = useFireTestEvent();

  if (!instanceId) {
    return [];
  }

  const result: PaletteCommand[] = [];

  for (const row of workflows ?? []) {
    const base = `/stream/workflows/${row.engineWorkflowId}`;
    const item: PaletteCommand = {
      id: `workflow:${row.engineWorkflowId}`,
      title: workflowName(row),
      kind: "item",
      group: "Workflows",
      subtitle: workflowDescription(row),
      keywords: ["workflow"],
      meta: row.isEnabled ? undefined : "Disabled",
      icon: Workflow,
      action: { type: "navigate", href: base },
      isOpenAt: isAtOrBelow(base),
    };
    const enabled = row.isEnabled;
    item.children = [
      childOf(item, {
        id: "edit",
        title: "Edit in builder",
        kind: "action",
        icon: Pencil,
        action: { type: "navigate", href: `${base}/edit` },
      }),
      childOf(item, {
        id: "runs",
        title: "View runs",
        kind: "action",
        keywords: ["history", "executions"],
        icon: History,
        action: { type: "navigate", href: workflowRunsPath(row.engineWorkflowId) },
      }),
      childOf(item, {
        id: "toggle",
        title: enabled ? "Disable workflow" : "Enable workflow",
        kind: "action",
        keywords: [enabled ? "turn off" : "turn on"],
        icon: enabled ? PowerOff : Power,
        action: {
          type: "run",
          run: async () => {
            await setWorkflowEnabled({ instanceId, engineWorkflowId: row.engineWorkflowId, isEnabled: !enabled });
            return `${item.title} ${enabled ? "disabled" : "enabled"}`;
          },
        },
      }),
    ];
    result.push(item);
  }

  for (const cmd of commands ?? []) {
    const href = commandEditorPath(cmd.engineCommandId);
    const item: PaletteCommand = {
      id: `command:${cmd.engineCommandId}`,
      title: `!${cmd.command}`,
      kind: "item",
      group: "Chat commands",
      keywords: [cmd.command, "command"],
      meta: cmd.enabled ? undefined : "Disabled",
      icon: SquareTerminal,
      action: { type: "navigate", href },
      isOpenAt: isAtOrBelow(href),
    };
    item.children = [
      childOf(item, {
        id: "toggle",
        title: cmd.enabled ? "Disable command" : "Enable command",
        kind: "action",
        keywords: [cmd.enabled ? "turn off" : "turn on"],
        icon: cmd.enabled ? PowerOff : Power,
        action: {
          type: "run",
          run: async () => {
            await updateCommand({
              instanceId,
              engineCommandId: cmd.engineCommandId,
              command: cmd.command,
              actions: cmd.actions ?? [],
              cooldown: cmd.cooldown,
              priority: cmd.priority,
              enabled: !cmd.enabled,
              visibility: cmd.visibility,
              groupIds: cmd.groupIds,
              usernames: cmd.usernames,
              argumentPattern: cmd.argumentPattern ?? "",
            });
            return `${item.title} ${cmd.enabled ? "disabled" : "enabled"}`;
          },
        },
      }),
    ];
    result.push(item);
  }

  for (const group of commandGroups ?? []) {
    const href = commandGroupEditorPath(group.engineGroupId);
    result.push({
      id: `command-group:${group.engineGroupId}`,
      title: groupLabel(group),
      kind: "item",
      group: "Command groups",
      keywords: ["group", "permissions"],
      icon: FolderTree,
      action: { type: "navigate", href },
    });
  }

  const moduleFor = (kind: { moduleName: string } | null | undefined, row: ResourceInstanceDoc) =>
    kind?.moduleName ?? row.moduleName;
  const resourceRun = (row: ResourceInstanceDoc, moduleName: string, actionId: string, params = {}) => {
    return async () => {
      await runResourceAction(row, moduleName, actionId, params);
      return undefined;
    };
  };

  for (const row of counters ?? []) {
    const moduleName = moduleFor(counterKind, row);
    const href = `/stream/counters/${encodeURIComponent(row.resourceInstanceId)}`;
    const value = counterValue(values?.[row.canonicalId], resourceSettings(row));
    const item: PaletteCommand = {
      id: `counter:${row.canonicalId}`,
      title: resourceName(row),
      kind: "item",
      group: "Counters",
      keywords: ["counter"],
      meta: String(value),
      icon: Tally5,
      action: { type: "navigate", href },
      isOpenAt: isAtOrBelow(href),
    };
    item.children = [
      childOf(item, {
        id: "increment",
        title: "Increment",
        kind: "action",
        keywords: ["add", "plus", "+1", "up"],
        meta: String(value),
        icon: Plus,
        action: { type: "run", run: resourceRun(row, moduleName, "counter.increment"), keepOpen: true },
      }),
      childOf(item, {
        id: "decrement",
        title: "Decrement",
        kind: "action",
        keywords: ["subtract", "minus", "-1", "down"],
        meta: String(value),
        icon: Minus,
        action: { type: "run", run: resourceRun(row, moduleName, "counter.decrement"), keepOpen: true },
      }),
      childOf(item, {
        id: "set",
        title: "Set value…",
        kind: "action",
        icon: Pencil,
        action: {
          type: "prompt",
          prompt: {
            placeholder: `New value for ${item.title}`,
            submitLabel: (text) => `Set ${item.title} to ${text || "…"}`,
            run: async (text) => {
              const next = Number(text.trim());
              if (text.trim() === "" || !Number.isInteger(next)) {
                throw new Error("Type a whole number");
              }
              await runResourceAction(row, moduleName, "counter.set", { value: next });
              return `${item.title} set to ${next}`;
            },
          },
        },
      }),
      childOf(item, {
        id: "reset",
        title: "Reset",
        kind: "action",
        keywords: ["zero", "clear"],
        icon: RotateCcw,
        confirm: true,
        action: { type: "run", run: resourceRun(row, moduleName, "counter.reset") },
      }),
    ];
    result.push(item);
  }

  const now = Date.now();
  for (const row of timers ?? []) {
    const moduleName = moduleFor(timerKind, row);
    const href = `/stream/timers/${encodeURIComponent(row.resourceInstanceId)}`;
    const state = timerState(values?.[row.canonicalId], resourceSettings(row), now);
    const running = state.running && state.remainingMs > 0;
    const item: PaletteCommand = {
      id: `timer:${row.canonicalId}`,
      title: resourceName(row),
      kind: "item",
      group: "Timers",
      keywords: ["timer", "countdown"],
      meta: `${formatDuration(state.remainingMs)}${running ? " ▶" : ""}`,
      icon: Timer,
      action: { type: "navigate", href },
      isOpenAt: isAtOrBelow(href),
    };
    const addTime = (seconds: number, label: string) =>
      childOf(item, {
        id: `add-${seconds}`,
        title: label,
        kind: "action",
        keywords: ["add time", "extend"],
        icon: Plus,
        action: { type: "run", run: resourceRun(row, moduleName, "timer.add", { seconds }), keepOpen: true },
      });
    item.children = [
      running
        ? childOf(item, {
            id: "pause",
            title: "Pause",
            kind: "action",
            keywords: ["stop"],
            icon: Pause,
            action: { type: "run", run: resourceRun(row, moduleName, "timer.pause") },
          })
        : childOf(item, {
            id: "start",
            title: "Start",
            kind: "action",
            keywords: ["resume", "play"],
            icon: Play,
            action: { type: "run", run: resourceRun(row, moduleName, "timer.start") },
          }),
      addTime(60, "Add 1 minute"),
      addTime(300, "Add 5 minutes"),
      childOf(item, {
        id: "set",
        title: "Set time…",
        kind: "action",
        icon: Pencil,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Time left, e.g. 90, 1:30 or 1:02:30",
            submitLabel: (text) => `Set ${item.title} to ${text || "…"}`,
            run: async (text) => {
              const seconds = parseDuration(text);
              if (seconds === null) {
                throw new Error("Type a time such as 90, 1:30 or 1:02:30");
              }
              await runResourceAction(row, moduleName, "timer.set", { seconds });
              return `${item.title} set to ${formatDuration(seconds * 1000)}`;
            },
          },
        },
      }),
      childOf(item, {
        id: "reset",
        title: "Reset",
        kind: "action",
        icon: RotateCcw,
        confirm: true,
        action: { type: "run", run: resourceRun(row, moduleName, "timer.reset") },
      }),
    ];
    result.push(item);
  }

  for (const row of queues ?? []) {
    const moduleName = moduleFor(queueKind, row);
    const href = `/stream/queues/${encodeURIComponent(row.resourceInstanceId)}`;
    const entries = queueEntries(values?.[row.canonicalId]);
    const item: PaletteCommand = {
      id: `queue:${row.canonicalId}`,
      title: resourceName(row),
      kind: "item",
      group: "Queues",
      keywords: ["queue", "line"],
      meta: `${entries.length} waiting`,
      icon: ListOrdered,
      action: { type: "navigate", href },
      isOpenAt: isAtOrBelow(href),
    };
    item.children = [
      childOf(item, {
        id: "next",
        title: entries[0] ? `Next: ${entries[0]}` : "Next",
        kind: "action",
        keywords: ["next", "advance", "pop"],
        icon: SkipForward,
        action: { type: "run", run: resourceRun(row, moduleName, "queue.next"), keepOpen: true },
      }),
      childOf(item, {
        id: "add",
        title: "Add to queue…",
        kind: "action",
        keywords: ["join", "enqueue"],
        icon: Plus,
        action: {
          type: "prompt",
          prompt: {
            placeholder: "Who or what to add",
            submitLabel: (text) => `Add ${text || "…"} to ${item.title}`,
            run: async (text) => {
              await runResourceAction(row, moduleName, "queue.add", { entry: text.trim() });
              return `Added ${text.trim()} to ${item.title}`;
            },
          },
        },
      }),
      ...entries.map((entry, index) =>
        childOf(item, {
          id: `remove-${index}`,
          title: `Remove ${entry}`,
          kind: "action",
          icon: Minus,
          action: { type: "run", run: resourceRun(row, moduleName, "queue.remove", { entry }), keepOpen: true },
        })
      ),
      childOf(item, {
        id: "clear",
        title: "Clear queue",
        kind: "action",
        keywords: ["empty"],
        icon: Trash2,
        confirm: true,
        action: { type: "run", run: resourceRun(row, moduleName, "queue.clear") },
      }),
    ];
    result.push(item);
  }

  for (const scene of scenes ?? []) {
    if (!scene.engineSceneId) {
      continue;
    }
    const href = `/stream/scenes/${scene.engineSceneId}`;
    result.push({
      id: `scene:${scene.engineSceneId}`,
      title: scene.name,
      kind: "item",
      group: "Scenes",
      subtitle: scene.description,
      keywords: ["scene", "overlay"],
      icon: Layers,
      action: { type: "navigate", href },
    });
  }

  for (const mod of modules ?? []) {
    const key = bareModuleKey(mod.moduleKey) ?? mod._id;
    result.push({
      id: `module:${key}`,
      title: mod.name,
      kind: "item",
      group: "Modules",
      subtitle: mod.description,
      keywords: ["module", ...(mod.tags ?? [])],
      meta: mod.status && mod.status !== "installed" ? mod.status : `v${mod.version}`,
      icon: Puzzle,
      action: { type: "navigate", href: `/modules/${key}` },
    });
  }

  for (const row of recaps ?? []) {
    if (!row.session) {
      continue;
    }
    result.push({
      id: `recap:${row.sessionId}`,
      title: new Date(row.session.startedAt).toLocaleDateString(undefined, RECAP_DATE),
      kind: "item",
      group: "Stream recaps",
      keywords: ["recap", "stream", "session"],
      icon: Tv,
      action: { type: "navigate", href: streamRecapPath(row.sessionId) },
    });
  }

  for (const section of flattenAlertTree(buildAlertTree(triggerPresets))) {
    const href = `/stream/alerts/${section.id.split("/").map(encodeURIComponent).join("/")}`;
    const item: PaletteCommand = {
      id: `alert:${section.id}`,
      title: section.label,
      kind: "item",
      group: "Alerts",
      keywords: ["alert", ...section.presets.map((preset) => preset.name)],
      icon: Bell,
      action: { type: "navigate", href },
      isOpenAt: isAtOrBelow(href),
    };
    item.children = section.presets.map((preset) =>
      childOf(item, {
        id: `test:${preset.id}`,
        title: `Fire test ${preset.name}`,
        kind: "action",
        keywords: ["test event", "simulate", "trigger", "debug"],
        icon: FlaskConical,
        action: {
          type: "run",
          run: async () => {
            const fields = testEventFields(preset);
            const fired = await fireTestEvent(preset, payloadFromValues(fields, initialValues(fields)));
            return fired ? `Fired a test ${preset.name}` : undefined;
          },
        },
      })
    );
    result.push(item);
  }

  for (const macro of macros ?? []) {
    // A macro that asks for values, or that calls a URL from this browser, stays on its pad.
    if (macro.type === "http-request" || hasMacroVariables(macro.config)) {
      continue;
    }
    result.push({
      id: `macro:${macro.id}`,
      title: macro.label,
      kind: "action",
      group: "Macros",
      keywords: ["macro", "button"],
      icon: Zap,
      action: {
        type: "run",
        run: async () => {
          if (macro.type === "send-message") {
            await sendChatMessage({ instanceId, message: applyMacroVariables(macro.config, {}).message ?? "" });
          } else {
            await runMacro({ instanceId, macroId: macro.id as Id<"macros">, values: [] });
          }
          return `Ran ${macro.label}`;
        },
      },
    });
  }

  for (const preset of presets ?? []) {
    result.push({
      id: `stream-preset:${preset.id}`,
      title: `Apply stream preset: ${preset.name}`,
      kind: "action",
      group: "Stream",
      keywords: ["title", "category", "tags", "stream info"],
      icon: Tv,
      action: {
        type: "run",
        run: async () => {
          const { unapplied } = await updateChannelInfo({ instanceId, ...preset.info });
          return unapplied.length > 0
            ? `Applied ${preset.name}; Twitch kept its own ${unapplied.join(", ")}`
            : `Applied ${preset.name}`;
        },
      },
    });
  }

  return result;
}
