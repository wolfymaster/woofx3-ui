import { MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { COMMAND_LIST_PATH } from "@/lib/command-editor-route";

/** The event a platform's chat messages arrive on, which the Alerts page lists commands beside. */
export const CHAT_MESSAGE_EVENT = "user.message";

/**
 * Chat commands are workflows too, but they belong to the Commands screen: they carry a
 * command word, cooldown, visibility and groups, none of which an alert trigger edits.
 * This is a pointer to that canonical screen, not a list of commands dressed as triggers.
 */
export function ChatCommandsLink() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] text-muted-foreground"
      data-testid="chat-commands-link"
    >
      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Chat commands have their own settings.</span>
      <Link href={COMMAND_LIST_PATH} className="font-medium text-primary underline-offset-4 hover:underline">
        Manage chat commands →
      </Link>
    </div>
  );
}
