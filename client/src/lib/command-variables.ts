import type { VariableOption } from "@/lib/workflow-variables";

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
