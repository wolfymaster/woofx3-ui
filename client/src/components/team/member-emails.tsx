import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Stands in for every address while they are hidden. Fixed, so it gives away nothing about the real one. */
export const MASKED_EMAIL = "••••••••@••••••";

/**
 * Whether this member list came with email addresses. The server sends them
 * only to a viewer allowed to see them (the organization owner) and leaves the
 * field out for everyone else.
 */
export function hasMemberEmails(members: ReadonlyArray<{ email?: string | null }>): boolean {
  return members.some((member) => member.email !== undefined);
}

interface EmailVisibilityToggleProps {
  shown: boolean;
  onShownChange: (shown: boolean) => void;
}

export function EmailVisibilityToggle({ shown, onShownChange }: EmailVisibilityToggleProps) {
  const Icon = shown ? EyeOff : Eye;
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={shown}
      onClick={() => onShownChange(!shown)}
      data-testid="button-toggle-emails"
    >
      <Icon className="h-4 w-4 mr-2" />
      {shown ? "Hide emails" : "Show emails"}
    </Button>
  );
}

/** A member's email line: masked until shown, and nothing at all for a viewer who wasn't sent it. */
export function MemberEmail({ email, shown }: { email?: string | null; shown: boolean }) {
  if (email === undefined) {
    return null;
  }
  return (
    <p className="text-sm text-muted-foreground" data-testid="text-member-email">
      {shown ? (email ?? "—") : MASKED_EMAIL}
    </p>
  );
}
