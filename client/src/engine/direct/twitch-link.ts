import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { useEffect, useState } from "react";
import type { TwitchLinkGateway } from "@/engine/gateway";
import type { TwitchLinkFlow, TwitchLinking } from "@/engine/types";
import type { Cancel } from "@/lib/engine-session/deps";
import { type DeviceLinkingEvent, IDLE_LINKING, nextDeviceLinking, toTwitchLink } from "./map/twitch-link";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";

// The engine links Twitch itself with Twitch's device code grant: it starts
// the login and polls Twitch, and the screen shows the streamer the code and
// where to type it. Nothing leaves the page, so `start`'s `returnTo` is unused.

const UPDATE_ENGINE_MESSAGE = "This engine can't link Twitch. Update the engine to link it.";
const NOT_CONFIGURED_MESSAGE = "This engine has no Twitch app to link with.";

/**
 * Follows one screen's device login attempts: starts the engine's login,
 * asks it where the login stands every `deviceLoginPollMs` until it ends,
 * and reports each step as a `DeviceLinkingEvent`. At most one attempt runs.
 */
class DeviceLoginFollower {
  /** The login being followed; null while none is, `starting` until the engine answers. */
  private attempt: { loginId: string; nextPoll: Cancel | null } | "starting" | null = null;

  constructor(
    private readonly runtime: DirectRuntime,
    private readonly report: (event: DeviceLinkingEvent) => void,
    private readonly linked: () => void
  ) {}

  readonly start = (): void => {
    if (this.attempt !== null) {
      return;
    }
    this.report({ type: "start" });
    if (!this.runtime.supports(ENGINE_CAPABILITIES.twitchDeviceLogin)) {
      this.report({ type: "refused", error: UPDATE_ENGINE_MESSAGE });
      return;
    }
    this.attempt = "starting";
    this.runtime
      .call("startTwitchDeviceLogin", (api) => api.startTwitchDeviceLogin())
      .then((result) => {
        if (this.attempt !== "starting") {
          if (result.ok) {
            this.cancelOnEngine(result.login.loginId);
          }
          return;
        }
        if (!result.ok) {
          this.attempt = null;
          this.report({
            type: "refused",
            error: result.code === "not_configured" ? NOT_CONFIGURED_MESSAGE : result.error,
          });
          return;
        }
        this.attempt = { loginId: result.login.loginId, nextPoll: null };
        this.report({ type: "codeIssued", login: result.login });
        this.schedulePoll();
      })
      .catch((error: unknown) => {
        if (this.attempt === "starting") {
          this.attempt = null;
          this.report({ type: "refused", error: error instanceof Error ? error.message : String(error) });
        }
      });
  };

  readonly cancel = (): void => {
    this.stop();
    this.report({ type: "cancel" });
  };

  /** Stops following, and tells the engine to forget a login still under way. */
  stop(): void {
    const current = this.attempt;
    this.attempt = null;
    if (current === null || current === "starting") {
      return;
    }
    current.nextPoll?.();
    this.cancelOnEngine(current.loginId);
  }

  private cancelOnEngine(loginId: string): void {
    this.runtime
      .call("cancelTwitchDeviceLogin", (api) => api.cancelTwitchDeviceLogin(loginId))
      .catch((error: unknown) => {
        this.runtime.logger.warn("could not cancel the Twitch device login", { error });
      });
  }

  private schedulePoll(): void {
    const followed = this.attempt;
    if (followed === null || followed === "starting") {
      return;
    }
    followed.nextPoll = this.runtime.clock.schedule(this.runtime.config.deviceLoginPollMs, () => {
      followed.nextPoll = null;
      this.runtime
        .call("getTwitchDeviceLogin", (api) => api.getTwitchDeviceLogin(followed.loginId))
        .then((result) => {
          if (this.attempt !== followed) {
            return;
          }
          if (!result.ok) {
            this.attempt = null;
            this.report({ type: "refused", error: "The Twitch login was cancelled. Start again." });
            return;
          }
          if (result.state.status === "pending") {
            this.schedulePoll();
            return;
          }
          this.attempt = null;
          this.report({ type: "ended", state: result.state });
          if (result.state.status === "linked") {
            this.linked();
          }
        })
        .catch((error: unknown) => {
          // A dropped connection is not the login's outcome: ask again.
          this.runtime.logger.warn("could not read the Twitch device login", { error });
          if (this.attempt === followed) {
            this.schedulePoll();
          }
        });
    });
  }
}

export function directTwitchLinkGateway(runtime: DirectRuntime): TwitchLinkGateway {
  const twitch = directTwitch(runtime);
  const invalidateLink = () => runtime.queryClient.invalidateQueries({ queryKey: twitch.linkRead.queryKey });

  const unlink = async (): Promise<void> => {
    await runtime.call("deleteTwitchToken", (api) => api.deleteTwitchToken());
    await invalidateLink();
  };

  function useLinkFlow(): TwitchLinkFlow {
    const [linking, setLinking] = useState<TwitchLinking>(IDLE_LINKING);
    const [follower] = useState(
      () =>
        new DeviceLoginFollower(
          runtime,
          (event) => setLinking((current) => nextDeviceLinking(current, event)),
          () => void invalidateLink()
        )
    );
    useEffect(() => () => follower.stop(), [follower]);
    return { linking, start: follower.start, cancel: follower.cancel };
  }

  return {
    useLink: () => useEngineQuery(runtime, twitch.linkRead, { select: toTwitchLink }),
    useLinkFlow,
    useUnlinkRequest: () => useEngineRequest(unlink),
  };
}
