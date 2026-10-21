import { useEngineGateway } from "@/engine/context";

/** Reads the channel's ad schedule. */
export function useAdScheduleRequest() {
  return useEngineGateway().adBreaks.useScheduleRequest();
}

export function useSnoozeNextAdRequest() {
  return useEngineGateway().adBreaks.useSnoozeRequest();
}
