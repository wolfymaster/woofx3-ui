import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { AlertCircle, BellRing, Clock, type LucideIcon, Zap } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeAlertFailure } from "@/lib/alert-failure";
import { alertStatusStyle } from "@/lib/alert-status";
import { alertTone, buildTrace, initialSpanId, type RunAlertRecord, type TraceSpan } from "@/lib/run-trace";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import {
  buildTimeline,
  formatDuration,
  parseEngineTime,
  type RunRecord,
  type Timeline,
} from "@/lib/workflow-run-timeline";
import { SpanDetails, type SpanSubject } from "./span-details";
import { TONE_STYLE } from "./tone-style";
import { TraceWaterfall } from "./trace-waterfall";

interface RunTraceProps {
  instanceId: Id<"instances">;
  engineRunId: string;
  /** Controls rendered beside the summary, such as replay. */
  actions?: (run: { failedStepTaskId: string | null }) => ReactNode;
}

/**
 * One recorded run as a trace: a summary of how it went, every span on one time
 * axis, and the details of whichever span is selected.
 *
 * Opens on the span that broke the run when one did, since that is why most
 * people come here.
 */
export function RunTrace({ instanceId, engineRunId, actions }: RunTraceProps) {
  const data = useQuery(api.workflowRuns.runWithSteps, { instanceId, engineRunId });
  const timeline = useMemo(() => (data ? buildTimeline(data.run, data.steps) : null), [data]);
  const trace = useMemo(
    () => (data && timeline ? buildTrace(data.run, timeline, data.alerts) : null),
    [data, timeline]
  );
  // Null until someone picks a span, so the default can follow the run as it
  // updates live -- a step failing after the page opened becomes the default.
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <div className="space-y-4" data-testid="alert-run-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (data === null || timeline === null || trace === null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">This run is no longer available.</p>
      </Card>
    );
  }

  const { run, alerts } = data;
  const selectedId = pickedId && trace.spans.some((span) => span.id === pickedId) ? pickedId : initialSpanId(trace);
  const subject = subjectFor(selectedId, trace.spans, { run, timeline, alerts });
  const runStyle = TONE_STYLE[timeline.tone];
  const failedAttempts = timeline.steps.filter((step) => step.tone === "failure").length;
  const retries = timeline.steps.filter((step) => step.attempt > 1).length;
  const runFailure = timeline.failedStep?.error ?? run.error;
  const failureCopy = runFailure ? describeAlertFailure(runFailure) : null;
  const lastAlert = alerts[alerts.length - 1];
  const startedMs = parseEngineTime(run.startedAt);

  return (
    <div className="space-y-4" data-testid="alert-run">
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{run.workflowName ?? run.workflowId}</h2>
              <Badge variant="secondary" className={cn("text-xs", runStyle.color)}>
                {run.status}
              </Badge>
            </div>
            {startedMs !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(startedMs).toLocaleString()} · {formatTimeAgo(new Date(startedMs).toISOString())}
              </p>
            )}
          </div>
          {actions && <div>{actions({ failedStepTaskId: timeline.failedStep?.taskId ?? null })}</div>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={Clock}
            label="Duration"
            value={timeline.durationMs !== undefined ? formatDuration(timeline.durationMs) : "—"}
            detail={timeline.tone === "running" ? "still running" : "start to finish"}
          />
          <Stat
            icon={Zap}
            label="Trigger"
            value={timeline.trigger?.type ?? "—"}
            detail={timeline.trigger?.platform ?? timeline.trigger?.source ?? "not recorded"}
            mono
          />
          <Stat
            icon={AlertCircle}
            label="Steps"
            value={String(timeline.steps.length)}
            detail={
              failedAttempts > 0
                ? `${failedAttempts} failed${retries > 0 ? `, ${retries} retried` : ""}`
                : retries > 0
                  ? `${retries} retried`
                  : "none failed"
            }
            bad={failedAttempts > 0}
          />
          <Stat
            icon={BellRing}
            label="Overlay alert"
            value={lastAlert ? alertStatusStyle(lastAlert.status).label : "—"}
            detail={
              alerts.length > 1
                ? `${alerts.length} published`
                : lastAlert
                  ? (lastAlert.error ?? "published")
                  : "none published"
            }
            bad={lastAlert !== undefined && alertTone(lastAlert.status) === "failure"}
          />
        </div>

        {runFailure && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm" data-testid="run-failure">
            <p className="font-medium text-red-500">
              {timeline.failedStep ? `${timeline.failedStep.label} failed: ` : ""}
              {failureCopy?.title ?? runFailure}
            </p>
            {failureCopy && <p className="mt-1 text-xs text-muted-foreground">{failureCopy.hint}</p>}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="text-sm font-semibold">Trace</h3>
          <span className="text-xs text-muted-foreground">
            {trace.spans.length} spans · {trace.originMs === null ? "no timing recorded" : formatDuration(trace.spanMs)}
          </span>
        </div>
        <TraceWaterfall trace={trace} selectedId={selectedId} onSelect={setPickedId} />
        {timeline.steps.length === 0 && run.status === "running" && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">Waiting for the first step to report…</p>
        )}
      </Card>

      {subject && (
        <Card className="p-4">
          {/* Keyed so each span's panels start from their own defaults rather than
              inheriting the last span's filter or view. */}
          <SpanDetails key={subject.span.id} subject={subject} />
        </Card>
      )}
    </div>
  );
}

/** The record behind a span id, for the details panel. */
function subjectFor(
  id: string | null,
  spans: readonly TraceSpan[],
  source: { run: RunRecord; timeline: Timeline; alerts: readonly RunAlertRecord[] }
): SpanSubject | null {
  const span = spans.find((candidate) => candidate.id === id);
  if (!span) {
    return null;
  }
  switch (span.kind) {
    case "trigger":
      return source.timeline.trigger
        ? { kind: "trigger", span, trigger: source.timeline.trigger, runStartedAt: source.run.startedAt }
        : null;
    case "run":
      return { kind: "run", span, run: source.run };
    case "step": {
      const step = source.timeline.steps.find((candidate) => `step:${candidate.key}` === span.id);
      return step ? { kind: "step", span, step } : null;
    }
    case "alert": {
      const alert = source.alerts.find((candidate) => `alert:${candidate.engineAlertId}` === span.id);
      return alert ? { kind: "alert", span, alert } : null;
    }
  }
}

interface StatProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  bad?: boolean;
  mono?: boolean;
}

function Stat({ icon: Icon, label, value, detail, bad, mono }: StatProps) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", bad && "text-red-500")} />
        {label}
      </div>
      <p
        className={cn(
          "mt-1 truncate font-semibold tabular-nums",
          mono ? "font-mono text-sm" : "text-xl",
          bad && "text-red-500"
        )}
        title={value}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}
