import type { CommandEditorState } from "@/lib/command-drafts";
import { splitCommandInput } from "@/lib/command-input";
import { argumentNames } from "@/lib/command-variables";

type WhenFields = Pick<
  CommandEditorState,
  "command" | "cooldown" | "enabled" | "visibility" | "groupIds" | "usernames"
>;

/** The "When" card's sentence for a command: what a chatter types to run it. */
export function commandWhenTitle(input: string): string {
  const { command, argumentPattern } = splitCommandInput(input);
  if (!command) {
    return "A chatter types a command";
  }
  return `A chatter types !${argumentPattern ? `${command} ${argumentPattern}` : command}`;
}

/**
 * The facts the "When" card shows under its sentence: who can use the command, its
 * cooldown, what each argument captures, and whether it is off. `groupName` names a group
 * by engine id, or returns undefined for one that no longer exists.
 */
export function commandWhenOptions(
  fields: WhenFields,
  groupName: (engineGroupId: string) => string | undefined
): string[] {
  const options: string[] = [];
  if (!fields.enabled) {
    options.push("Turned off");
  }
  options.push(whoCanUse(fields, groupName));
  options.push(fields.cooldown > 0 ? `${fields.cooldown} second cooldown` : "No cooldown");

  const names = argumentNames(splitCommandInput(fields.command).argumentPattern);
  names.forEach((name, index) => {
    const last = index === names.length - 1;
    options.push(last ? `{${name}} is the rest of what they type` : `{${name}} is the next word they type`);
  });
  return options;
}

function whoCanUse(fields: WhenFields, groupName: (engineGroupId: string) => string | undefined): string {
  if (fields.visibility === "public") {
    return "Anyone can use it";
  }
  const granted = [
    ...fields.groupIds.map((id) => groupName(id)).filter((name): name is string => name !== undefined),
    ...fields.usernames,
  ];
  if (granted.length === 0) {
    return "No one can use it yet";
  }
  if (granted.length <= 2) {
    return `Only ${granted.join(" and ")}`;
  }
  return `Only ${granted.slice(0, 2).join(", ")} and ${granted.length - 2} more`;
}
