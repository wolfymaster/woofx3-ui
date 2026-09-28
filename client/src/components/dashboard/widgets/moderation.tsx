import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useInstance } from "@/hooks/use-instance";
import { BlockedTermsSection } from "./moderation-blocked-terms";
import { ChatLockdownSection } from "./moderation-chat-lockdown";
import { UserActionsSection } from "./moderation-user-actions";

// Everything a streamer with no active mods needs when a spammer shows up:
// block the phrase, deal with the user, lock chat down. Ordered by how fast
// each has to happen, and every section says why it is disabled rather than
// failing on click.

export function ModerationWidget() {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const access = useQuery(api.moderation.access, instanceId ? { instanceId } : "skip");

  if (!instanceId || access === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (access === null || access.timeout === "not-linked") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <ShieldAlert className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          {access === null
            ? "You are not a member of this instance"
            : "Connect Twitch in Settings → Integrations to moderate chat"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-3">
        <BlockedTermsSection
          instanceId={instanceId}
          addStatus={access.addBlockedTerm}
          removeStatus={access.removeBlockedTerm}
        />
        <UserActionsSection instanceId={instanceId} timeoutStatus={access.timeout} banStatus={access.ban} />
        <ChatLockdownSection instanceId={instanceId} status={access.chatSettings} />
      </div>
    </div>
  );
}
