import type { ShoutoutEntry as HostShoutoutEntry, ShoutoutChannel, ShoutoutQueueView } from "@/desktop/host";
import type { ShoutoutEntry, TwitchChannel } from "@/engine/types";
import { toShoutoutEntryId } from "../ids";

export function toShoutoutEntry(entry: HostShoutoutEntry): ShoutoutEntry {
  return {
    id: toShoutoutEntryId(entry.id),
    login: entry.login,
    displayName: entry.displayName,
    profileImageUrl: entry.profileImageUrl,
    broadcasterType: entry.broadcasterType,
    attempts: entry.attempts,
    nextEligibleAt: entry.nextEligibleAt,
    lastError: entry.lastError,
  };
}

/** Selects the queue's entries from the cached view; module-level so the mapped list keeps its identity. */
export function toShoutoutEntries(view: ShoutoutQueueView): ShoutoutEntry[] {
  return view.entries.map(toShoutoutEntry);
}

export function fromTwitchChannel(channel: TwitchChannel): ShoutoutChannel {
  return {
    twitchUserId: channel.twitchUserId,
    login: channel.login,
    displayName: channel.displayName,
    profileImageUrl: channel.profileImageUrl,
    broadcasterType: channel.broadcasterType,
  };
}
