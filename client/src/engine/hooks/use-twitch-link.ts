import { useEngineGateway } from "@/engine/context";

/** The Twitch account the instance acts as; null when none is linked. */
export function useTwitchLink() {
  return useEngineGateway().twitchLink.useLink();
}

/** Starts and follows linking Twitch for the calling component. */
export function useTwitchLinkFlow() {
  return useEngineGateway().twitchLink.useLinkFlow();
}

/** Removes the instance's Twitch link. Owners and admins only. */
export function useUnlinkTwitchRequest() {
  return useEngineGateway().twitchLink.useUnlinkRequest();
}
