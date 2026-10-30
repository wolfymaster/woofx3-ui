import type { CommandArgs, CommandName, CommandResults } from "@desktop-host/window";
import { invoke } from "@tauri-apps/api/core";

/** A command's arguments: none for a command whose arguments are `null`. */
type ArgsOf<C extends CommandName> = CommandArgs[C] extends null ? [] : [args: CommandArgs[C]];

/**
 * Calls a host command with its generated argument and result types. A
 * command with arguments takes them as its one `args` parameter, as the
 * companion window's own helper (companion/ui/src/invoke.ts) does.
 */
export function call<C extends CommandName>(command: C, ...[args]: ArgsOf<C>): Promise<CommandResults[C]> {
  return invoke<CommandResults[C]>(command, args === undefined ? {} : { args });
}
