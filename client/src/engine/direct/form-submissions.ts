import { GatewayUnsupportedError } from "@/engine/errors";
import type { FormSubmissionsGateway } from "@/engine/gateway";
import type { FormSubmission, Paginated } from "@/engine/types";

const NO_SUBMISSIONS: Paginated<FormSubmission> = {
  results: [],
  status: "Exhausted",
  isLoading: false,
  loadMore: () => undefined,
};

/** A lone engine has no public page, so no form of its can have answers waiting. */
export const directFormSubmissionsGateway: FormSubmissionsGateway = {
  supported: false,
  useList: () => NO_SUBMISSIONS,
  useQueueStatus: () => null,
  useRetryRequest: () => () => Promise.reject(new GatewayUnsupportedError("formSubmissions.retry")),
};
