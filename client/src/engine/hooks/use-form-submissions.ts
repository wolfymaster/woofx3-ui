import { useEngineGateway } from "@/engine/context";

/** Whether this engine's forms have an outbox to show. */
export function useFormSubmissionsSupported() {
  return useEngineGateway().formSubmissions.supported;
}

export function useFormSubmissions(formId: string, initialNumItems: number) {
  return useEngineGateway().formSubmissions.useList(formId, initialNumItems);
}

export function useFormSubmissionQueueStatus() {
  return useEngineGateway().formSubmissions.useQueueStatus();
}

export function useRetryFormSubmissionRequest() {
  return useEngineGateway().formSubmissions.useRetryRequest();
}
