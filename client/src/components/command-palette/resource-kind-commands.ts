import type { ConfigField } from "@woofx3/api/ui-schema";
import { Play } from "lucide-react";
import type { ComponentType } from "react";
import type { ResourceAction } from "@/lib/resource-actions";
import { type ResourceInstanceDoc, resourceName } from "@/lib/resource-instance";
import { hasFirstPartyPage, pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";
import { summarizeResourceValue } from "@/lib/resource-values";
import type { PaletteCommand } from "./types";

/** A resource kind an installed module declares, as the palette shows it. */
export interface PaletteResourceKind {
  moduleName: string;
  kind: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  /** The kind's `display.summary`: where in a value the reading beside its name is. */
  summaryPath?: string;
  /** Every action aimed at the kind, from whichever module declares one. */
  actions: ResourceAction[];
}

export type RunKindAction = (
  row: ResourceInstanceDoc,
  action: ResourceAction,
  parameters: Record<string, unknown>
) => Promise<boolean>;

/**
 * An item for every instance of a kind without a first-party page, such as each
 * wheel, with every action aimed at its kind as a child. Built from declarations
 * alone, like the kind's page, so a module's kind is reachable here without the
 * palette knowing what the kind means. The first-party kinds have hand-made
 * items with richer actions, so they are left out.
 */
export function resourceKindItemCommands(
  kinds: readonly PaletteResourceKind[],
  instances: readonly ResourceInstanceDoc[],
  values: Readonly<Record<string, unknown>>,
  runAction: RunKindAction
): PaletteCommand[] {
  const result: PaletteCommand[] = [];
  for (const kind of kinds) {
    if (hasFirstPartyPage(kind.moduleName, kind.kind)) {
      continue;
    }
    const prefix = `${kind.moduleName}:${kind.kind}:`;
    const basePath = resourceKindPath(kind.moduleName, kind.kind);
    const noun = kind.name || kind.kind;
    for (const row of instances) {
      if (!row.canonicalId.startsWith(prefix)) {
        continue;
      }
      const href = `${basePath}/${encodeURIComponent(row.resourceInstanceId)}`;
      const item: PaletteCommand = {
        id: `resource:${row.canonicalId}`,
        title: resourceName(row),
        kind: "item",
        group: pluralKindName(noun),
        keywords: [noun.toLowerCase(), kind.kind],
        meta: summarizeResourceValue(values[row.canonicalId], kind.summaryPath) || undefined,
        icon: kind.icon,
        action: { type: "navigate", href },
        isOpenAt: (path) => path === href || path.startsWith(`${href}/`),
      };
      item.children = kind.actions.map((action) => actionCommand(item, href, row, action, runAction));
      result.push(item);
    }
  }
  return result;
}

/**
 * One action on one instance. An action that needs nothing more runs at once; one
 * that needs a single line of text or a number asks for it; anything more opens the
 * instance's page, whose form holds every field the action declares.
 */
function actionCommand(
  item: PaletteCommand,
  href: string,
  row: ResourceInstanceDoc,
  action: ResourceAction,
  runAction: RunKindAction
): PaletteCommand {
  const { preset } = action;
  const base = {
    id: `${item.id}:${preset.id}`,
    group: item.group,
    subtitle: item.title,
    hiddenUntilSearch: true,
    kind: "action" as const,
    keywords: preset.description ? [preset.description] : undefined,
  };
  const asks = requiredFields(action);
  const done = `${preset.name}: ${item.title}`;

  if (asks.length === 0) {
    return {
      ...base,
      title: preset.name,
      icon: Play,
      action: {
        type: "run",
        run: async () => ((await runAction(row, action, {})) ? done : undefined),
        keepOpen: true,
      },
    };
  }
  const [field] = asks;
  if (asks.length === 1 && (field.type === "text" || field.type === "number")) {
    return {
      ...base,
      title: `${preset.name}…`,
      icon: Play,
      action: {
        type: "prompt",
        prompt: {
          placeholder: field.placeholder || field.label,
          submitLabel: (text) => `${preset.name}: ${text || "…"}`,
          run: async (text) => {
            const value = promptValue(field, text);
            return (await runAction(row, action, { [field.id]: value })) ? done : undefined;
          },
        },
      },
    };
  }
  return { ...base, title: `${preset.name}…`, icon: Play, action: { type: "navigate", href } };
}

/** The fields the action cannot run without, other than the one that picks the instance. */
function requiredFields(action: ResourceAction): ConfigField[] {
  return (action.preset.config?.fields ?? []).filter((field) => field.id !== action.fieldId && field.required);
}

/** What a prompt's text means for `field`; throws, to show as the failure, when it means nothing. */
export function promptValue(field: ConfigField, text: string): string | number {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error(`Type ${field.label.toLowerCase()}`);
  }
  if (field.type !== "number") {
    return trimmed;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new Error(`${field.label} must be a number`);
  }
  if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
    throw new Error(`${field.label} must be between ${field.min ?? "-∞"} and ${field.max ?? "∞"}`);
  }
  return value;
}
