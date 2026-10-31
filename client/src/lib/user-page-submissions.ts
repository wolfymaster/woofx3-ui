import type { DashboardSubmission, SubmissionQueueStatus } from "@convex/userPageForms";

/** How a submission's status reads on the dashboard. */
export function submissionStatusLabel(status: DashboardSubmission["status"]): string {
  switch (status) {
    case "pending":
      return "Waiting to send";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
  }
}

export function submissionAnswerText(value: string | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return value === "" ? "No answer" : value;
}

/** Why answers are waiting, when it's something about the engine and not the answers. */
export function engineProblemMessage(problem: NonNullable<SubmissionQueueStatus["engineProblem"]>): string {
  switch (problem) {
    case "not_registered":
      return "This page's engine isn't set up yet. Answers are saved and will be sent once it is.";
    case "unreachable":
      return "We can't reach your engine right now. Answers are saved and will be sent when it's back.";
    case "capability_missing":
      return "Your engine needs an update before it can receive form answers. They're saved until then.";
  }
}
