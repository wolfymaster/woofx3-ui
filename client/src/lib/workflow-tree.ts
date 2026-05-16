import type { ConditionConfig, TaskDefinition, WaitConfig, WorkflowDefinition } from "@woofx3/api";

export interface WorkflowTree {
  trigger: TriggerNode;
  steps: StepNode[];
}

export interface TriggerNode {
  type: "trigger";
  id: string;
  event: string;
  conditions: ConditionConfig[];
}

export type StepNode = ActionNode | ConditionNode | WaitNode;

export interface ActionNode {
  type: "action";
  id: string;
  action: string;
  parameters: Record<string, unknown>;
}

export interface ConditionNode {
  type: "condition";
  id: string;
  conditions: ConditionConfig[];
  thenBranch: StepNode[];
  elseBranch: StepNode[];
}

export interface WaitNode {
  type: "wait";
  id: string;
  wait: WaitConfig;
}

function buildTaskMap(tasks: TaskDefinition[]): Map<string, TaskDefinition> {
  const map = new Map<string, TaskDefinition>();
  for (const task of tasks) {
    map.set(task.id, task);
  }
  return map;
}

function getRootTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  const referenced = new Set<string>();
  for (const task of tasks) {
    for (const ref of task.onTrue ?? []) {
      referenced.add(ref);
    }
    for (const ref of task.onFalse ?? []) {
      referenced.add(ref);
    }
  }
  return tasks.filter((t) => !referenced.has(t.id));
}

function convertTaskToNode(task: TaskDefinition, taskMap: Map<string, TaskDefinition>): StepNode {
  if (task.type === "action") {
    return {
      type: "action",
      id: task.id,
      action: task.action ?? "",
      parameters: task.parameters ?? {},
    };
  }

  if (task.type === "condition") {
    const thenBranch: StepNode[] = [];
    const elseBranch: StepNode[] = [];

    for (const childId of task.onTrue ?? []) {
      const childTask = taskMap.get(childId);
      if (childTask) {
        thenBranch.push(convertTaskToNode(childTask, taskMap));
      }
    }

    for (const childId of task.onFalse ?? []) {
      const childTask = taskMap.get(childId);
      if (childTask) {
        elseBranch.push(convertTaskToNode(childTask, taskMap));
      }
    }

    return {
      type: "condition",
      id: task.id,
      conditions: task.conditions ?? [],
      thenBranch,
      elseBranch,
    };
  }

  if (task.type === "wait") {
    return {
      type: "wait",
      id: task.id,
      wait: task.wait ?? { type: "event", event: "" },
    };
  }

  return {
    type: "action",
    id: task.id,
    action: "",
    parameters: {},
  };
}

export function definitionToTree(def: WorkflowDefinition): WorkflowTree {
  const trigger: TriggerNode = {
    type: "trigger",
    id: "__trigger",
    event: def.trigger.type === "event" ? def.trigger.event : "",
    conditions: def.trigger.conditions ?? [],
  };

  const taskMap = buildTaskMap(def.tasks);
  const rootTasks = getRootTasks(def.tasks);
  const steps = rootTasks.map((task) => convertTaskToNode(task, taskMap));

  return { trigger, steps };
}

function convertNodeToTask(node: StepNode): TaskDefinition {
  if (node.type === "action") {
    return {
      id: node.id,
      type: "action",
      action: node.action,
      parameters: node.parameters,
    };
  }

  if (node.type === "condition") {
    const tasks: TaskDefinition[] = [
      {
        id: node.id,
        type: "condition",
        conditions: node.conditions,
        onTrue: node.thenBranch.map((child) => child.id),
        onFalse: node.elseBranch.map((child) => child.id),
      },
    ];

    for (const child of node.thenBranch) {
      tasks.push(convertNodeToTask(child));
    }

    for (const child of node.elseBranch) {
      tasks.push(convertNodeToTask(child));
    }

    return tasks[0];
  }

  return {
    id: node.id,
    type: "wait",
    wait: node.wait,
  };
}

function flattenSteps(steps: StepNode[]): TaskDefinition[] {
  const tasks: TaskDefinition[] = [];

  for (const step of steps) {
    const task = convertNodeToTask(step);
    tasks.push(task);

    if (step.type === "condition") {
      tasks.push(...flattenSteps(step.thenBranch));
      tasks.push(...flattenSteps(step.elseBranch));
    }
  }

  return tasks;
}

export function treeToDefinition(tree: WorkflowTree): WorkflowDefinition {
  const tasks = flattenSteps(tree.steps);

  for (let i = 1; i < tasks.length; i++) {
    const prevTask = tasks[i - 1];
    const currTask = tasks[i];

    if (!currTask.dependsOn || currTask.dependsOn.length === 0) {
      const isReferenced = tasks.some(
        (t) =>
          (t.onTrue?.includes(currTask.id) ?? false) ||
          (t.onFalse?.includes(currTask.id) ?? false)
      );

      if (!isReferenced) {
        currTask.dependsOn = [prevTask.id];
      }
    }
  }

  return {
    id: "",
    name: "",
    trigger: {
      type: "event",
      event: tree.trigger.event,
      conditions: tree.trigger.conditions,
    },
    tasks,
  };
}
