import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { type TwitchUserBadgeSource, twitchUserBadges } from "@/lib/twitch-user-badges";
import { cn } from "@/lib/utils";

export interface TwitchUserCardUser extends TwitchUserBadgeSource {
  login: string;
  displayName: string;
  profileImageUrl?: string;
}

/**
 * A Twitch person as a face, name and badges, for any step that asks "is this
 * who you mean?" before acting on them. `children` holds that step's own
 * confirm and cancel controls.
 */
export function TwitchUserCard({
  user,
  children,
  className,
  "data-testid": testId,
}: {
  user: TwitchUserCardUser;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const badges = twitchUserBadges(user);
  return (
    <div className={cn("space-y-3 rounded-md border border-border p-3", className)} data-testid={testId}>
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarImage src={user.profileImageUrl} alt="" />
          <AvatarFallback>{user.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{user.displayName}</span>
            {badges.map((badge) => (
              <Badge key={badge} variant="secondary" className="px-1.5 py-0 text-[10px]">
                {badge}
              </Badge>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">twitch.tv/{user.login}</span>
        </div>
      </div>
      {children}
    </div>
  );
}
