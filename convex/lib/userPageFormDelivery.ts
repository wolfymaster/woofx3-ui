import type { UserPageSubmissionDelivery } from "@woofx3/api";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { EngineTimeoutError, withEngineTimeout } from "./inboundWebhookRelay";
import { boundedReason, SUBMISSION_DELIVERY } from "./userPageSubmissions";

export interface SubmissionEngine {
  url: string;
  clientId: string;
  clientSecret: string;
}

export type SubmissionReceiptStatus = "recorded" | "duplicate";

/**
 * How a submission reaches an instance's engine. Everything about the route
 * lives behind this, so another way to reach an engine is another
 * implementation; the outbox does not change.
 */
export interface SubmissionTransport {
  /** Whether the engine can take submissions. Throws when it cannot be reached. */
  canDeliver(engine: SubmissionEngine): Promise<boolean>;
  /** Resolves only with the engine's receipt. */
  deliver(engine: SubmissionEngine, delivery: UserPageSubmissionDelivery): Promise<SubmissionReceiptStatus>;
}

function readReceipt(receipt: { status?: unknown }): SubmissionReceiptStatus {
  if (receipt.status === "recorded" || receipt.status === "duplicate") {
    return receipt.status;
  }
  throw new Error(`Engine answered with an unreadable receipt: ${JSON.stringify(receipt)}`);
}

/** Direct capnweb calls, for engines Convex can reach: the managed ones. */
export const ENGINE_SUBMISSION_TRANSPORT: SubmissionTransport = {
  async canDeliver(engine) {
    const report = await withEngineTimeout(fetchEngineCapabilities(engine), SUBMISSION_DELIVERY.engineCallTimeoutMs);
    return hasEngineCapability(report, "userPages.formSubmissions");
  },
  async deliver(engine, delivery) {
    const session = createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
    const receipt = await withEngineTimeout(
      session.deliverUserPageSubmission(delivery),
      SUBMISSION_DELIVERY.engineCallTimeoutMs
    );
    return readReceipt(receipt);
  },
};

export type DeliveryFailure =
  /** The engine refused this submission as malformed, which a resend cannot fix. */
  | { kind: "rejected"; reason: string }
  /** The engine could not be reached: stop this pass and back off the whole engine. */
  | { kind: "retry"; scope: "engine"; reason: string }
  /** Something went wrong with this one call: back off this submission and try the next. */
  | { kind: "retry"; scope: "submission"; reason: string };

/**
 * What a refused delivery's message starts with: the engine found it malformed.
 * Must match `USER_PAGE_SUBMISSION_REFUSED` in `@woofx3/api/rpc`.
 */
const ENGINE_REFUSAL_PREFIX = "UserPageSubmissionRefused: ";

/**
 * Failures with no answer from the engine: a timeout, or `fetch` itself
 * failing, which capnweb reports as a TypeError or as a batch without a
 * good response.
 */
function isTransportError(error: unknown): boolean {
  return (
    error instanceof EngineTimeoutError ||
    error instanceof TypeError ||
    (error instanceof Error && error.message.startsWith("RPC request failed"))
  );
}

/**
 * Whether a failed delivery is worth resending. Anything not recognised as a
 * rejection is retryable, since a wrong retry costs a resend and a wrong
 * rejection loses the answer until someone notices.
 */
export function classifyDeliveryError(error: unknown): DeliveryFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(ENGINE_REFUSAL_PREFIX)) {
    return { kind: "rejected", reason: boundedReason(message.slice(ENGINE_REFUSAL_PREFIX.length)) };
  }
  const scope = isTransportError(error) ? "engine" : "submission";
  return { kind: "retry", scope, reason: boundedReason(message) };
}

/** What a pass learned about its engine, which sets the queue's backoff. */
export type PassEngineState = "reached" | "not_contacted" | "not_registered" | "unreachable" | "capability_missing";

/** The function calls a pass makes; an action's context, or a test's backend. */
export type DeliveryRunner = Pick<ActionCtx, "runMutation">;

/**
 * One delivery pass over an instance's due submissions. The queue's lease keeps
 * passes from overlapping, and each outcome is saved as it arrives. A pass that
 * dies leaves its lease to run out and the sweep to start another.
 */
export async function runDeliveryPass(
  ctx: DeliveryRunner,
  instanceId: Id<"instances">,
  transport: SubmissionTransport
): Promise<void> {
  const claim = await ctx.runMutation(internal.userPageForms.claimDeliveryPass, { instanceId });
  if (claim === null) {
    return;
  }
  let engineState: PassEngineState = "not_contacted";
  if (claim.batch.length > 0) {
    engineState =
      claim.engine === null ? "not_registered" : await deliverBatch(ctx, claim.engine, claim.batch, transport);
  }
  await ctx.runMutation(internal.userPageForms.finishDeliveryPass, { instanceId, engineState });
}

async function deliverBatch(
  ctx: DeliveryRunner,
  engine: SubmissionEngine,
  batch: UserPageSubmissionDelivery[],
  transport: SubmissionTransport
): Promise<PassEngineState> {
  try {
    if (!(await transport.canDeliver(engine))) {
      return "capability_missing";
    }
  } catch {
    return "unreachable";
  }
  for (const delivery of batch) {
    const submissionId = delivery.submissionId as Id<"pageSubmissions">;
    let receipt: SubmissionReceiptStatus;
    try {
      receipt = await transport.deliver(engine, delivery);
    } catch (error: unknown) {
      const failure = classifyDeliveryError(error);
      await ctx.runMutation(internal.userPageForms.recordDeliveryOutcome, {
        submissionId,
        outcome:
          failure.kind === "rejected"
            ? { kind: "rejected", reason: failure.reason }
            : { kind: "retry", reason: failure.reason },
      });
      if (failure.kind === "retry" && failure.scope === "engine") {
        return "unreachable";
      }
      continue;
    }
    await ctx.runMutation(internal.userPageForms.recordDeliveryOutcome, {
      submissionId,
      outcome: { kind: "delivered", receipt },
    });
  }
  return "reached";
}
