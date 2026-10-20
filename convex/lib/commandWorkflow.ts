/**
 * Whether a stored workflow definition is the one a chat command runs: its
 * trigger has type "command" (see docs/services/commands-ui.md in the woofx3
 * engine repo). Such a workflow belongs to its command and is edited from the
 * command, so lists of workflows leave it out.
 */
export function isCommandWorkflow(definition: unknown): boolean {
  if (typeof definition !== "object" || definition === null) {
    return false;
  }
  const trigger = (definition as { trigger?: unknown }).trigger;
  return typeof trigger === "object" && trigger !== null && (trigger as { type?: unknown }).type === "command";
}
