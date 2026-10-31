import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { DashboardSubmission } from "@convex/userPageForms";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import type { FormSubmissionsGateway } from "@/engine/gateway";
import type { FormSubmission, FormSubmissionId, FormSubmissionQueueStatus, Paginated } from "@/engine/types";
import { useScopeInstanceId } from "./scope";

function toFormSubmission(row: DashboardSubmission): FormSubmission {
  return { ...row, id: row.id as string as FormSubmissionId };
}

function useList(formId: string, initialNumItems: number): Paginated<FormSubmission> {
  const instanceId = useScopeInstanceId();
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.userPageForms.listSubmissions,
    instanceId ? { instanceId, formId } : "skip",
    { initialNumItems }
  );
  const submissions = useMemo(() => results.map(toFormSubmission), [results]);
  return { results: submissions, status, isLoading, loadMore };
}

function useQueueStatus(): FormSubmissionQueueStatus | null | undefined {
  const instanceId = useScopeInstanceId();
  const status = useQuery(api.userPageForms.queueStatus, instanceId ? { instanceId } : "skip");
  return status && { ...status, engineProblem: status.engineProblem ?? null };
}

function useRetryRequest() {
  const retry = useMutation(api.userPageForms.retrySubmission);
  return useCallback(
    async (submissionId: FormSubmissionId) => {
      await retry({ submissionId: submissionId as string as Id<"pageSubmissions"> });
    },
    [retry]
  );
}

export const convexFormSubmissionsGateway: FormSubmissionsGateway = {
  supported: true,
  useList,
  useQueueStatus,
  useRetryRequest,
};
