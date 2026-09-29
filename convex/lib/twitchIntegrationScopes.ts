/** Twitch OAuth scopes for Settings → Integrations connect (not sign-in). */
export const TWITCH_INTEGRATION_SCOPES = [
  "user:read:email",
  "user:bot",
  "user:write:chat",
  "user:read:chat",
  "chat:read",
  "chat:edit",
  "bits:read",
  "channel:manage:broadcast",
  // The ad schedule and snoozing the next ad. Optional: a link granted before
  // these were added keeps working and only the Ad breaks widget goes quiet.
  "channel:manage:ads",
  "channel:read:ads",
  "channel:moderate",
  "channel:read:hype_train",
  "channel:read:polls",
  "channel:read:predictions",
  "channel:read:redemptions",
  "channel:read:subscriptions",
  "clips:edit",
  "moderator:manage:announcements",
  "moderator:manage:blocked_terms",
  "moderator:manage:shoutouts",
  "moderator:manage:banned_users",
  // Pinning, unpinning and updating a pinned chat message. The read half below
  // covers only reading the current pin, so a link granted before this was
  // added can see what is pinned but not change it.
  "moderator:manage:chat_messages",
  // Chat lockdown modes (follower-only, subscriber-only, emote-only, slow).
  // The read half below shows the current modes; a link granted before this
  // was added can see them but not change them.
  "moderator:manage:chat_settings",
  "moderator:read:chatters",
  "moderator:read:chat_messages",
  "moderator:read:chat_settings",
  "moderator:read:followers",
  "moderator:read:moderators",
  "moderator:read:unban_requests",
  "moderator:read:warnings",
  "moderator:read:vips",
] as const;
