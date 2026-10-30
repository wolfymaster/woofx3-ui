import {
  missingTwitchScopeMessage,
  TWITCH_NOT_CONNECTED_MESSAGE,
  twitchLinkRefusal,
} from "@shared/twitch-link-refusal";
import { ENGINE_CAPABILITIES, type EngineCapability, type TwitchHelixResult, type TwitchLinkInfo } from "@woofx3/api";
import type { DirectEngineApi } from "./connection";
import { directKeys as k } from "./keys";
import { engineHelixAnswer } from "./map/twitch";
import type { EngineRead } from "./query";
import type { DirectRuntime } from "./runtime";

// What the Twitch namespaces share: the engine's Twitch link, read once and
// kept current by `twitch.link.changed`, and the engine's Twitch methods,
// each answering as Twitch did. A call is refused by the link's scopes before
// it is sent, with the words the Convex gateway refuses with.

type TwitchMethod = Extract<keyof DirectEngineApi, `twitch${string}`>;

export type LinkedTwitchAccount = Extract<TwitchLinkInfo, { linked: true }>;

const UPDATE_ENGINE = "This engine can't make that Twitch call. Update the engine to use it.";

export interface DirectTwitch {
  readonly linkRead: EngineRead<TwitchLinkInfo>;
  /**
   * The linked account when the link holds `scope` (null: none needed);
   * otherwise rejects with the refusal, or with `missingScope` in place of
   * the missing-scope one.
   */
  authorize(scope: string | null, missingScope?: string): Promise<LinkedTwitchAccount>;
  /** One engine Twitch method, needing `capability`, its result read as Twitch's answer. */
  helix(
    capability: EngineCapability,
    method: TwitchMethod,
    invoke: (api: DirectEngineApi) => PromiseLike<TwitchHelixResult>
  ): Promise<Response>;
}

export function directTwitch(runtime: DirectRuntime): DirectTwitch {
  const linkRead: EngineRead<TwitchLinkInfo> = {
    queryKey: k.twitch.link(),
    queryFn: () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.twitchLinkRead)) {
        throw new Error(UPDATE_ENGINE);
      }
      return runtime.call("getTwitchLink", (api) => api.getTwitchLink());
    },
  };

  const authorize = async (scope: string | null, missingScope?: string): Promise<LinkedTwitchAccount> => {
    const link = await runtime.queryClient.fetchQuery(linkRead);
    const linked = link.linked ? link : null;
    // A missing link is always refused, so `linked` is null only alongside a refusal.
    const refusal = twitchLinkRefusal(linked, scope);
    if (refusal !== null || linked === null) {
      const said = refusal ?? TWITCH_NOT_CONNECTED_MESSAGE;
      const missing = scope !== null && said === missingTwitchScopeMessage(scope);
      throw new Error(missing && missingScope !== undefined ? missingScope : said);
    }
    return linked;
  };

  const helix: DirectTwitch["helix"] = async (capability, method, invoke) => {
    if (!runtime.supports(capability)) {
      throw new Error(UPDATE_ENGINE);
    }
    const { response, unconfirmed } = engineHelixAnswer(await runtime.call(method, invoke));
    if (unconfirmed !== null) {
      runtime.logger.warn("twitch: the engine could not confirm Twitch's answer", { method, error: unconfirmed });
    }
    return response;
  };

  return { linkRead, authorize, helix };
}
