import {
  AD_MANAGE_SCOPE,
  AD_READ_SCOPE,
  AD_SCHEDULE_UNREADABLE_MESSAGE,
  AD_SCOPE_MISSING_MESSAGE,
  AD_SNOOZE_UNREADABLE_MESSAGE,
  parseHelixAdSchedule,
  parseHelixSnoozeResult,
  readAdAnswer,
} from "@shared/ad-breaks";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { AdBreaksGateway } from "@/engine/gateway";
import type { AdSchedule, AdSnoozeResult } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";

/** The ad schedule and snoozing, through the engine's `twitch.ads` methods. */
export function directAdBreaksGateway(runtime: DirectRuntime): AdBreaksGateway {
  const twitch = directTwitch(runtime);
  /** Helix sends no clock of its own; the schedule's times are read against the gateway's. */
  const now = () => new Date(runtime.clock.now()).toISOString();

  const body = async (operation: "read" | "snooze", response: Response): Promise<unknown> => {
    const parsed = await readAdAnswer(operation, response);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    return parsed.body;
  };

  const schedule = async (): Promise<AdSchedule> => {
    await twitch.authorize(AD_READ_SCOPE, AD_SCOPE_MISSING_MESSAGE);
    const response = await twitch.helix(ENGINE_CAPABILITIES.twitchAds, "twitchGetAdSchedule", (api) =>
      api.twitchGetAdSchedule()
    );
    const result = parseHelixAdSchedule(await body("read", response), now());
    if (!result) {
      throw new Error(AD_SCHEDULE_UNREADABLE_MESSAGE);
    }
    return result;
  };

  const snooze = async (): Promise<AdSnoozeResult> => {
    await twitch.authorize(AD_MANAGE_SCOPE, AD_SCOPE_MISSING_MESSAGE);
    const response = await twitch.helix(ENGINE_CAPABILITIES.twitchAds, "twitchSnoozeNextAd", (api) =>
      api.twitchSnoozeNextAd()
    );
    const result = parseHelixSnoozeResult(await body("snooze", response), now());
    if (!result) {
      throw new Error(AD_SNOOZE_UNREADABLE_MESSAGE);
    }
    return result;
  };

  return {
    useScheduleRequest: () => useEngineRequest(schedule),
    useSnoozeRequest: () => useEngineRequest(snooze),
  };
}
