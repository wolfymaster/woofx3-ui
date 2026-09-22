import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { alertTarget } from "@/lib/alert-envelope";
import { describeAlertFailure } from "@/lib/alert-failure";
import { alertStatusStyle } from "@/lib/alert-status";
import { parsePayload, splitCloudEvent } from "@/lib/payload-fields";
import type { RunAlertRecord, TraceSpan } from "@/lib/run-trace";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  parseEngineTime,
  type RunRecord,
  type TimelineStep,
  type TimelineTrigger,
} from "@/lib/workflow-run-timeline";
import { PayloadPanel } from "./payload-panel";
import { TONE_STYLE } from "./tone-style";

/** What the selected span is, with the record it was drawn from. */
export type SpanSubject =
  | { kind: "trigger"; span: TraceSpan; trigger: TimelineTrigger; runStartedAt?: string }
  | { kind: "run"; span: TraceSpan; run: RunRecord }
  | { kind: "step"; span: TraceSpan; step: TimelineStep }
  | { kind: "alert"; span: TraceSpan; alert: RunAlertRecord };

/**
 * Everything recorded about one span, pulled out of its payloads: the identity and
 * timing fields as a table, the failure in plain words, then each payload as fields
 * with the raw JSON a toggle away.
 */
export function SpanDetails({ subject }: { subject: SpanSubject }) {
  const { span } = subject;
  const style = TONE_STYLE[span.tone];
  const statusLabel = subject.kind === "alert" ? alertStatusStyle(subject.alert.status).label : span.status;
  const timing = [
    span.startMs === null ? null : `starts at +${formatDuration(span.startMs)}`,
    span.startMs !== null && span.endMs !== null ? `took ${formatDuration(span.endMs - span.startMs)}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4" data-testid={`alert-run-details-${span.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className={cn("text-base font-semibold", subject.kind === "trigger" && "font-mono text-sm")}>
          {span.label}
        </h3>
        <Badge variant="secondary" className={cn("text-[10px]", subject.kind === "trigger" ? "" : style.color)}>
          {statusLabel}
        </Badge>
        {timing.length > 0 && <span className="text-xs text-muted-foreground">{timing.join(" · ")}</span>}
      </header>

      {subject.kind === "trigger" && <TriggerDetails trigger={subject.trigger} runStartedAt={subject.runStartedAt} />}
      {subject.kind === "run" && <RunDetails run={subject.run} />}
      {subject.kind === "step" && <StepDetails step={subject.step} />}
      {subject.kind === "alert" && <AlertDetails alert={subject.alert} />}
    </div>
  );
}

function TriggerDetails({ trigger, runStartedAt }: { trigger: TimelineTrigger; runStartedAt?: string }) {
  const parts = splitCloudEvent(trigger.payload);
  const occurred = parseEngineTime(trigger.occurredAt);
  const started = parseEngineTime(runStartedAt);
  const latency = occurred !== undefined && started !== undefined ? started - occurred : undefined;

  return (
    <>
      <Attributes
        rows={[
          ["Event type", <Mono key="type">{trigger.type}</Mono>],
          ["Platform", trigger.platform],
          ["Source", trigger.source],
          ["Occurred", formatInstant(trigger.occurredAt)],
          // Negative when the platform's clock runs ahead of the engine's; not a
          // latency anyone can act on, so it is left out rather than shown as one.
          ["Run started after", latency !== undefined && latency >= 0 ? formatDuration(latency) : undefined],
        ]}
      />
      {parts ? (
        <>
          {parts.data !== undefined && (
            <PayloadPanel
              title="Event data"
              value={parts.data}
              raw={JSON.stringify(parts.data)}
              testId="alert-run-event-data"
            />
          )}
          <PayloadPanel
            title="Event attributes"
            value={parts.attributes}
            raw={JSON.stringify(parts.attributes)}
            testId="alert-run-event-attributes"
          />
        </>
      ) : (
        <PayloadPanel title="Event" value={parsePayload(trigger.payload)} raw={trigger.payload} />
      )}
    </>
  );
}

function RunDetails({ run }: { run: RunRecord }) {
  return (
    <>
      <Attributes
        rows={[
          ["Workflow", run.workflowName ?? <Mono key="wf">{run.workflowId}</Mono>],
          ["Workflow id", <Mono key="wfid">{run.workflowId}</Mono>],
          ["Run id", <Mono key="run">{run.engineRunId}</Mono>],
          ["Triggered by", run.triggeredBy],
          ["Started", formatInstant(run.startedAt)],
          ["Completed", formatInstant(run.completedAt)],
        ]}
      />
      {run.error && <ErrorCallout reason={run.error} />}
      <p className="text-xs text-muted-foreground">Select a step to see what it was given and what it produced.</p>
    </>
  );
}

function StepDetails({ step }: { step: TimelineStep }) {
  return (
    <>
      <Attributes
        rows={[
          ["Task", <Mono key="task">{step.taskId}</Mono>],
          ["Position", `step ${step.stepIndex + 1}`],
          ["Attempt", step.attempt > 1 ? String(step.attempt) : undefined],
          ["Started", formatInstant(step.startedAt)],
          ["Completed", formatInstant(step.completedAt)],
          ["Duration", step.durationMs !== undefined ? formatDuration(step.durationMs) : undefined],
        ]}
      />
      {step.error && <ErrorCallout reason={step.error} />}
      {step.inputs && (
        <PayloadPanel title="Inputs" value={parsePayload(step.inputs)} raw={step.inputs} testId="alert-run-inputs" />
      )}
      {step.outputs && (
        <PayloadPanel
          title="Outputs"
          value={parsePayload(step.outputs)}
          raw={step.outputs}
          testId="alert-run-outputs"
        />
      )}
      {!step.inputs && !step.outputs && (
        <p className="text-xs text-muted-foreground">This step recorded no inputs or outputs.</p>
      )}
    </>
  );
}

function AlertDetails({ alert }: { alert: RunAlertRecord }) {
  const envelope = parsePayload(alert.payload);
  const parameters =
    envelope && typeof envelope === "object" ? (envelope as { parameters?: unknown }).parameters : undefined;
  const dispatched = parseEngineTime(alert.dispatchedAt);
  const played = parseEngineTime(alert.playedAt);

  return (
    <>
      <Attributes
        rows={[
          ["Alert id", <Mono key="id">{alert.engineAlertId}</Mono>],
          ["Widget", alertTarget(alert.payload) ?? undefined],
          ["Dispatched", formatInstant(alert.dispatchedAt)],
          ["Started playing", formatInstant(alert.playedAt)],
          ["Finished", formatInstant(alert.completedAt)],
          [
            "Waited to play",
            dispatched !== undefined && played !== undefined && played >= dispatched
              ? formatDuration(played - dispatched)
              : undefined,
          ],
        ]}
      />
      {alert.error && <ErrorCallout reason={alert.error} />}
      {parameters !== undefined && (
        <PayloadPanel
          title="Alert parameters"
          value={parameters}
          raw={JSON.stringify(parameters)}
          testId="alert-run-alert-parameters"
        />
      )}
      <PayloadPanel title="Envelope" value={envelope} raw={alert.payload} testId="alert-run-alert-envelope" />
    </>
  );
}

/**
 * A failure in readable words when the reason is one we recognise, with the raw
 * reason underneath: the advice alone would hide what the engine actually said.
 */
function ErrorCallout({ reason }: { reason: string }) {
  const failure = describeAlertFailure(reason);
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs" data-testid="alert-run-error">
      <p className="font-medium text-red-500">{failure?.title ?? reason}</p>
      {failure && (
        <>
          <p className="mt-1 text-muted-foreground">{failure.hint}</p>
          <p className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80">{reason}</p>
        </>
      )}
    </div>
  );
}

/** Label and value pairs; a row with nothing to show is left out rather than printed empty. */
function Attributes({ rows }: { rows: [label: string, value: ReactNode | undefined][] }) {
  const present = rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (present.length === 0) {
    return null;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {present.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

/** A timestamp to the millisecond, since steps within one run are often milliseconds apart. */
function formatInstant(value: string | undefined): string | undefined {
  const ms = parseEngineTime(value);
  if (ms === undefined) {
    return undefined;
  }
  const date = new Date(ms);
  return `${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}
