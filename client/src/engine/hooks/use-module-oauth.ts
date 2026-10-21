import { useEngineGateway } from "@/engine/context";

/** Leaves for the provider to connect a module's OAuth integration. */
export function useModuleOAuthConnectRequest() {
  return useEngineGateway().moduleOAuth.useConnectRequest();
}

/** Finishes the connect the provider came back with. */
export function useModuleOAuthFinishRequest() {
  return useEngineGateway().moduleOAuth.useFinishRequest();
}
