import { useEngineGateway } from "@/engine/context";

/** The page intros the viewer has closed. */
export function useDismissedPageIntros() {
  return useEngineGateway().pageIntros.useDismissed();
}

export function useDismissPageIntroRequest() {
  return useEngineGateway().pageIntros.useDismissRequest();
}
