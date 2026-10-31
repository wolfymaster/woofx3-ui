import type { ShoutoutsGateway } from "@/engine/gateway";
import type { ReadOptions } from "@/engine/types";
import { canShoutOutOf } from "./map/twitch";
import { useEngineQuery } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";
import { unsupportedRead, unsupportedRequest } from "./unsupported";

/**
 * The queue is a Convex record that a schedule works through, and a lone
 * engine keeps none, so only whether the link may shout out is served:
 * screens shout out at once through `twitchChat` instead.
 */
export function directShoutoutsGateway(runtime: DirectRuntime): ShoutoutsGateway {
  const twitch = directTwitch(runtime);
  return {
    support: { queue: false },
    useCanShoutOut: ({ enabled = true }: ReadOptions = {}) =>
      useEngineQuery(runtime, twitch.linkRead, { enabled, select: canShoutOutOf }),
    useQueue: unsupportedRead("shoutouts.useQueue"),
    useLookupRequest: unsupportedRequest("shoutouts.useLookupRequest"),
    useEnqueueRequest: unsupportedRequest("shoutouts.useEnqueueRequest"),
    useRemoveRequest: unsupportedRequest("shoutouts.useRemoveRequest"),
    useReorderRequest: unsupportedRequest("shoutouts.useReorderRequest"),
  };
}
