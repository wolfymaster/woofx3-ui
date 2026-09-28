import type { CapabilityStatus } from "@convex/lib/moderation";
import type { ReactNode } from "react";

const PERMISSION_NAMES = {
  blockedTerms: "manage blocked terms",
  timeout: "time out users",
  ban: "ban and unban",
  chatSettings: "change chat modes",
} as const;

/** Why a section's controls are disabled, or nothing when they are not. */
export function CapabilityNote({
  status,
  capability,
}: {
  status: CapabilityStatus;
  capability: keyof typeof PERMISSION_NAMES;
}) {
  if (status === "ready") {
    return null;
  }
  const action = PERMISSION_NAMES[capability];
  const text =
    status === "needs-reconnect"
      ? `Needs reconnect: reconnect Twitch in Settings → Integrations to ${action}.`
      : status === "not-allowed"
        ? `Only the instance's owners and admins can ${action}.`
        : "Connect Twitch in Settings → Integrations.";
  return (
    <p className="text-xs text-muted-foreground" data-testid={`moderation-note-${capability}`}>
      {text}
    </p>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>;
}
