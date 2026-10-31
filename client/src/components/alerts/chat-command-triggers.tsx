import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useChatCommands } from "@/engine/hooks/use-chat-commands";
import { commandEditorPath } from "@/lib/command-editor-route";

/** The event a platform's chat messages arrive on, which the Alerts page lists commands beside. */
export const CHAT_MESSAGE_EVENT = "user.message";

/**
 * Chat commands, each read as the trigger it is. A command isn't a condition on the chat
 * message: the commander also checks who may run it, throttles it and reads its arguments,
 * so it opens on its own editor rather than a chat message trigger's.
 */
export function ChatCommandTriggers() {
  const commands = useChatCommands() ?? [];
  if (commands.length === 0) {
    return null;
  }
  const sorted = [...commands].sort((a, b) => a.command.localeCompare(b.command));
  return (
    <div className="flex flex-col gap-3" data-testid="chat-command-triggers">
      <h3 className="px-1 text-[13px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {sorted.length === 1 ? "1 chat command" : `${sorted.length} chat commands`}
      </h3>
      {sorted.map((command) => (
        <Link
          key={command.engineCommandId}
          href={commandEditorPath(command.engineCommandId)}
          className="flex items-center gap-2 rounded-2xl border bg-card py-3 pl-2 pr-4 hover:bg-accent"
        >
          <span className="flex w-9 shrink-0 items-center justify-center">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-base font-medium leading-snug">
            Someone uses <span className="text-primary-text">!{command.command}</span>
          </span>
          {!command.enabled && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-px text-xs text-foreground/80">Paused</span>
          )}
        </Link>
      ))}
    </div>
  );
}
