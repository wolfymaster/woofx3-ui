import { ArrowRight, Clock, GitBranch, Zap } from "lucide-react";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { cn } from "@/lib/utils";
import { actionNodeLabel, triggerNodeLabel } from "@/lib/workflow-node-label";
import { actionNodeSummary, triggerNodeSummary } from "@/lib/workflow-node-summary";
import type { StepNode, TriggerNode } from "@/lib/workflow-tree";

interface StepNodeProps {
  node: StepNode | TriggerNode;
  isSelected: boolean;
  onSelect: () => void;
  depth?: number;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  resourceLabels?: Map<string, string>;
}

const NODE_STYLES = {
  trigger: {
    border: "border-green-500/50 bg-green-500/5",
    icon: "bg-green-500/20 text-green-500",
    label: "Trigger",
  },
  action: {
    border: "border-blue-500/50 bg-blue-500/5",
    icon: "bg-blue-500/20 text-blue-500",
    label: "Action",
  },
  condition: {
    border: "border-yellow-500/50 bg-yellow-500/5",
    icon: "bg-yellow-500/20 text-yellow-500",
    label: "If",
  },
  wait: {
    border: "border-purple-500/50 bg-purple-500/5",
    icon: "bg-purple-500/20 text-purple-500",
    label: "Wait",
  },
};

function getNodeLabel(
  node: StepNode | TriggerNode,
  catalogTriggers: CatalogTriggerRow[],
  catalogActions: CatalogActionRow[]
): string {
  if (node.type === "trigger") {
    return triggerNodeLabel(node, catalogTriggers);
  }
  if (node.type === "action") {
    return actionNodeLabel(node, catalogActions);
  }
  if (node.type === "condition") {
    const cond = node.conditions[0];
    if (cond) {
      return `${cond.field} ${cond.operator} ${cond.value}`;
    }
    return "Condition";
  }
  if (node.type === "wait") {
    if (node.wait.type === "event") {
      return `Until ${node.wait.event}`;
    }
    return "Wait";
  }
  return "Unknown";
}

function formatConditionValue(value: unknown): string {
  return Array.isArray(value) ? value.join(" – ") : String(value);
}

function getNodeSummary(
  node: StepNode | TriggerNode,
  catalogTriggers: CatalogTriggerRow[],
  catalogActions: CatalogActionRow[],
  resourceLabels?: Map<string, string>
): string[] {
  if (node.type === "trigger") {
    return triggerNodeSummary(node, catalogTriggers, resourceLabels);
  }
  if (node.type === "action") {
    return actionNodeSummary(node, catalogActions, resourceLabels);
  }
  if (node.type === "condition") {
    // The first condition is already shown in the title; list any additional ones here.
    return node.conditions.slice(1).map((c) => `${c.field} ${c.operator} ${formatConditionValue(c.value)}`);
  }
  if (node.type === "wait") {
    const parts: string[] = [];
    if (node.wait.timeout) {
      parts.push(`Timeout: ${node.wait.timeout}`);
    }
    for (const c of node.wait.conditions ?? []) {
      parts.push(`${c.field} ${c.operator} ${formatConditionValue(c.value)}`);
    }
    return parts;
  }
  return [];
}

function getNodeIcon(node: StepNode | TriggerNode) {
  if (node.type === "trigger") {
    return Zap;
  }
  if (node.type === "action") {
    return ArrowRight;
  }
  if (node.type === "condition") {
    return GitBranch;
  }
  if (node.type === "wait") {
    return Clock;
  }
  return ArrowRight;
}

export function StepNodeCard({
  node,
  isSelected,
  onSelect,
  depth = 0,
  catalogTriggers,
  catalogActions,
  resourceLabels,
}: StepNodeProps) {
  const styles = NODE_STYLES[node.type as keyof typeof NODE_STYLES] ?? NODE_STYLES.action;
  const Icon = getNodeIcon(node);
  const label = getNodeLabel(node, catalogTriggers, catalogActions);
  // Trigger/action labels are already friendly catalog names; the kind prefix is only
  // useful for condition/wait nodes, which have no catalog-backed display name.
  const showKindPrefix = node.type === "condition" || node.type === "wait";
  const summary = getNodeSummary(node, catalogTriggers, catalogActions, resourceLabels);

  return (
    <button
      type="button"
      className={cn(
        "px-5 py-4 rounded-xl border-2 bg-card min-w-[240px] max-w-[400px] shadow-sm cursor-pointer transition-all",
        "w-full text-left",
        styles.border,
        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        "hover:shadow-md"
      )}
      style={{ marginLeft: depth * 24 }}
      onClick={onSelect}
      aria-pressed={isSelected}
      data-testid={`node-${node.type}-${node.id}`}
    >
      <div className="flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{showKindPrefix ? `${styles.label} ${label}` : label}</p>
          {summary.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {summary.map((line) => (
                <p key={line} className="text-xs text-muted-foreground truncate">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
