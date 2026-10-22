import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { AdBreaksGateway } from "@/engine/gateway";
import type { AdSchedule, AdSnoozeResult } from "@/engine/types";
import { withPlainError } from "./errors";
import { useInstanceAction } from "./scope";

// Convex asks Twitch with the broadcaster token it holds, through the engine
// when the engine advertises `twitch.ads`.

type ScheduleResult = FunctionReturnType<typeof api.adBreaks.getSchedule>;
type SnoozeResult = FunctionReturnType<typeof api.adBreaks.snoozeNextAd>;

export function toAdSchedule(schedule: ScheduleResult): AdSchedule {
  return {
    nextAdAt: schedule.nextAdAt,
    lastAdAt: schedule.lastAdAt,
    durationSeconds: schedule.durationSeconds,
    prerollFreeSeconds: schedule.prerollFreeSeconds,
    snoozeCount: schedule.snoozeCount,
    snoozeRefreshAt: schedule.snoozeRefreshAt,
    serverNow: schedule.serverNow,
  };
}

export function toAdSnoozeResult(result: SnoozeResult): AdSnoozeResult {
  return {
    snoozeCount: result.snoozeCount,
    snoozeRefreshAt: result.snoozeRefreshAt,
    nextAdAt: result.nextAdAt,
    serverNow: result.serverNow,
  };
}

function useScheduleRequest() {
  const getSchedule = useInstanceAction(api.adBreaks.getSchedule);
  return useCallback(async () => toAdSchedule(await getSchedule({}).catch(withPlainError)), [getSchedule]);
}

function useSnoozeRequest() {
  const snoozeNextAd = useInstanceAction(api.adBreaks.snoozeNextAd);
  return useCallback(async () => toAdSnoozeResult(await snoozeNextAd({}).catch(withPlainError)), [snoozeNextAd]);
}

export const convexAdBreaksGateway: AdBreaksGateway = {
  useScheduleRequest,
  useSnoozeRequest,
};
