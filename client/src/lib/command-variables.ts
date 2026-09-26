import type { ActionStep } from "@woofx3/api";
import { commandStepId } from "@/lib/command-drafts";
import type { ActionPreset } from "@/lib/workflow-presets";
import { stepOutputVariables, type VariableOption } from "@/lib/workflow-variables";

/** Matches a `{name}` placeholder in a command's argument pattern. */
const ARGUMENT_PATTERN = /\{([A-Za-z0-9_.]+)\}/g;

const GROUP = "Command";

/**
 * What a command's actions can reference: the chat message that invoked it,
 * plus whatever its argument pattern captured.
 *
 * These are the fields of the `chat.command.<slug>` event the engine runs the
 * actions against (ChatCommandEventData in the engine's cloudevents package),
 * so an action on a command and a workflow triggered by that same command see
 * the same payload under the same names.
 */
export function commandActionVariables(argumentPattern: string): VariableOption[] {
  const options: VariableOption[] = [
    {
      value: "${trigger.data.chatter}",
      label: "Chatter",
      group: GROUP,
      type: "string",
      description: "Who ran the command.",
    },
    {
      value: "${trigger.data.text}",
      label: "Arguments",
      group: GROUP,
      type: "string",
      description: "Everything the chatter typed after the command word.",
    },
    {
      value: "${trigger.data.command}",
      label: "Command",
      group: GROUP,
      type: "string",
      description: "The command word itself, without the leading '!'.",
    },
    {
      value: "${trigger.data.rawMessage}",
      label: "Whole message",
      group: GROUP,
      type: "string",
      description: "The chat message as sent, command word included.",
    },
  ];

  for (const name of argumentNames(argumentPattern)) {
    options.push({
      value: `\${trigger.data.variables.${name}}`,
      label: name,
      group: GROUP,
      type: "string",
      description: `The "${name}" argument this command captures.`,
    });
  }

  return options;
}

/**
 * What one of a command's steps can reference: everything commandActionVariables offers,
 * plus the declared outputs of each step that has finished by the time this one starts.
 *
 * The engine runs a command's steps as one dependency graph (sequentialTasks in
 * workflow/internal/engine/actions_run.go): a step waits on the ids in its `dependsOn`,
 * or on the step before it when that list is absent or empty. Only steps reachable
 * through that graph have run, so only their outputs are offered — anything else would
 * be a reference the engine cannot resolve.
 */
export function commandStepVariables(
  argumentPattern: string,
  steps: readonly ActionStep[],
  stepIndex: number,
  presetOf: (step: ActionStep) => ActionPreset | undefined
): VariableOption[] {
  if (stepIndex < 0 || stepIndex >= steps.length) {
    throw new Error(`step index ${stepIndex} is outside a command with ${steps.length} steps`);
  }
  const ids = steps.map((step, index) => commandStepId(step, index));
  const dependenciesOf = (index: number): string[] => {
    const declared = steps[index].dependsOn ?? [];
    if (declared.length > 0) {
      return declared;
    }
    return index > 0 ? [ids[index - 1]] : [];
  };

  const finished = new Set<string>();
  const pending = dependenciesOf(stepIndex);
  while (pending.length > 0) {
    const id = pending.pop() as string;
    const index = ids.indexOf(id);
    if (finished.has(id) || index < 0) {
      continue;
    }
    finished.add(id);
    pending.push(...dependenciesOf(index));
  }

  const options = commandActionVariables(argumentPattern);
  steps.forEach((step, index) => {
    if (!finished.has(ids[index])) {
      return;
    }
    const preset = presetOf(step);
    options.push(...stepOutputVariables(ids[index], preset?.name ?? ids[index], preset?.config?.outputs ?? []));
  });
  return options;
}

/** The `{name}` placeholders an argument pattern declares, in order, without repeats. */
export function argumentNames(argumentPattern: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null = ARGUMENT_PATTERN.exec(argumentPattern);
  while (match !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
    match = ARGUMENT_PATTERN.exec(argumentPattern);
  }
  ARGUMENT_PATTERN.lastIndex = 0;
  return names;
}
