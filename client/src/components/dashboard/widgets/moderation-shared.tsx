import type { ReactNode } from "react";
import { TwitchConnectNotice } from "@/components/common/twitch-connect-notice";
import type { ModerationCapabilityStatus } from "@/engine/types";

const PERMISSION_NAMES = {
  addBlockedTerm: "block terms",
  removeBlockedTerm: "remove blocked terms",
  timeout: "time out users",
  ban: "ban and unban",
  chatSettings: "change chat modes",
} as const;

/** Why a section's controls are disabled, or nothing when they are not. */
export function CapabilityNote({
  status,
  capability,
}: {
  status: ModerationCapabilityStatus;
  capability: keyof typeof PERMISSION_NAMES;
}) {
  if (status === "ready") {
    return null;
  }
  const action = PERMISSION_NAMES[capability];
  const testId = `moderation-note-${capability}`;
  if (status === "needs-reconnect") {
    return (
      <div data-testid={testId}>
        <TwitchConnectNotice to={action} reconnect />
      </div>
    );
  }
  if (status === "not-allowed") {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        Only owners and admins can {action}.
      </p>
    );
  }
  return (
    <div data-testid={testId}>
      <TwitchConnectNotice to="use this" />
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>;
}
