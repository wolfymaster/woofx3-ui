import { useEngineGateway } from "@/engine/context";

/** Clips the live stream. */
export function useCreateClipRequest() {
  return useEngineGateway().clips.useCreateRequest();
}
