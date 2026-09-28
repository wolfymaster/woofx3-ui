export interface TwitchUserBadgeSource {
  /** Helix's `broadcaster_type`: `partner`, `affiliate`, or empty. */
  broadcasterType?: string;
  /** Undefined when nobody could tell; only a known true shows a badge. */
  isModerator?: boolean;
  isVip?: boolean;
}

/** The labels a Twitch person card shows beside the name, most notable first. */
export function twitchUserBadges({ broadcasterType, isModerator, isVip }: TwitchUserBadgeSource): string[] {
  const badges: string[] = [];
  if (broadcasterType === "partner") {
    badges.push("Partner");
  } else if (broadcasterType === "affiliate") {
    badges.push("Affiliate");
  }
  if (isModerator === true) {
    badges.push("Moderator");
  }
  if (isVip === true) {
    badges.push("VIP");
  }
  return badges;
}
