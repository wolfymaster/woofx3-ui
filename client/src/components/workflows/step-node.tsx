import { ArrowRight, Clock, GitBranch, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepNode, TriggerNode } from "@/lib/workflow-tree";

interface StepNodeProps {
  node: StepNode | TriggerNode;
  isSelected: boolean;
  onSelect: () => void;
  depth?: number;
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

function getNodeLabel(node: StepNode | TriggerNode): string {
  if (node.type === "trigger") {
    return node.event || "Trigger";
  }
  if (node.type === "action") {
    return node.action || "Action";
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

export function StepNodeCard({ node, isSelected, onSelect, depth = 0 }: StepNodeProps) {
  const styles = NODE_STYLES[node.type as keyof typeof NODE_STYLES] ?? NODE_STYLES.action;
  const Icon = getNodeIcon(node);
  const label = getNodeLabel(node);

  return (
    <div
      className={cn(
        "px-5 py-4 rounded-xl border-2 bg-card min-w-[240px] max-w-[400px] shadow-sm cursor-pointer transition-all",
        styles.border,
        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        "hover:shadow-md"
      )}
      style={{ marginLeft: depth * 24 }}
      onClick={onSelect}
      data-testid={`node-${node.type}-${node.id}`}
    >
      <div className="flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {styles.label} {label}
          </p>
        </div>
      </div>
    </div>
  );
}
