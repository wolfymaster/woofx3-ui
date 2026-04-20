import type { TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import dagre from "dagre";
import type { Edge, Node } from "reactflow";

export interface ProjectionNode extends Node {
  data: {
    kind: "trigger" | "task";
    eventType?: string;
    task?: TaskDefinition;
  };
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

export function definitionToReactFlow(def: WorkflowDefinition): {
  nodes: ProjectionNode[];
  edges: Edge[];
} {
  const nodes: ProjectionNode[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "__trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { kind: "trigger", eventType: def.trigger.eventType },
  });

  for (const task of def.tasks) {
    nodes.push({
      id: task.id,
      type: task.type,
      position: { x: 0, y: 0 },
      data: { kind: "task", task },
    });
  }

  const referencedByBranch = new Set<string>();
  for (const task of def.tasks) {
    for (const r of task.onTrue ?? []) {
      referencedByBranch.add(r);
    }
    for (const r of task.onFalse ?? []) {
      referencedByBranch.add(r);
    }
  }

  for (const task of def.tasks) {
    if ((task.dependsOn?.length ?? 0) === 0 && !referencedByBranch.has(task.id)) {
      edges.push({
        id: `__trigger->${task.id}`,
        source: "__trigger",
        target: task.id,
      });
    }
    for (const parent of task.dependsOn ?? []) {
      edges.push({
        id: `${parent}->${task.id}`,
        source: parent,
        target: task.id,
      });
    }
    if (task.type === "condition") {
      for (const r of task.onTrue ?? []) {
        edges.push({
          id: `${task.id}->${r}:true`,
          source: task.id,
          target: r,
          data: { branch: "true" },
        });
      }
      for (const r of task.onFalse ?? []) {
        edges.push({
          id: `${task.id}->${r}:false`,
          source: task.id,
          target: r,
          data: { branch: "false" },
        });
      }
    }
  }

  applyDagreLayout(nodes, edges);
  return { nodes, edges };
}

function applyDagreLayout(nodes: ProjectionNode[], edges: Edge[]): void {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) {
      node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
    }
  }
}
