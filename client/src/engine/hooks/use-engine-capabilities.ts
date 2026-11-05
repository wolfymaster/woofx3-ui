import type { EngineCapability } from "@woofx3/api";
import { useEngineGateway } from "@/engine/context";

/**
 * Whether the scope's engine advertises `capability`. False while the answer
 * is loading and when the engine has not reported, so a gated feature stays
 * hidden rather than offering calls an older engine would refuse. Every gate
 * reads one cached answer per engine, however many a page renders.
 */
export function useEngineCapability(capability: EngineCapability): boolean {
  const capabilities = useEngineGateway().session.useCapabilities();
  return capabilities?.includes(capability) ?? false;
}
