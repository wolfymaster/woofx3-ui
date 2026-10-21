import { renderToStaticMarkup } from "react-dom/server";
import { EngineScopeProvider } from "@/engine/scope";
import type { EngineScope, InstanceId } from "@/engine/types";

// For the adapter's tests: renders a hook once on the server, without
// effects, below an engine scope, which is all a gateway hook needs to read
// its instance.

export const TEST_INSTANCE_ID = "instance-1" as InstanceId;

/** Runs `hook` under a scope holding `instanceId` (null: no instance selected) and returns its value. */
export function renderInScope<T>(hook: () => T, instanceId: InstanceId | null = TEST_INSTANCE_ID): T {
  const scope: EngineScope = { instanceId, optimisticInstanceId: instanceId, isInstanceLoading: false };
  let value: { current: T } | undefined;
  function Probe() {
    value = { current: hook() };
    return null;
  }
  renderToStaticMarkup(
    <EngineScopeProvider scope={scope}>
      <Probe />
    </EngineScopeProvider>
  );
  if (!value) {
    throw new Error("the probe did not render");
  }
  return value.current;
}
