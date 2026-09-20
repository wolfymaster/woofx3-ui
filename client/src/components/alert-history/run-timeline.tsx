import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Zap } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { WebhookEventPayloadDialog } from "@/components/debug/webhook-event-payload-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { buildTimeline, formatDuration, type TimelineStep } from "@/lib/workflow-run-timeline";
import { TONE_STYLE } from "./tone";

interface TimelineNodeProps {
  icon: ReactNode;
  iconBg: string;
  /** Draws the connector down to the next node. False for the last node. */
  continues: boolean;
  children: ReactNode;
  testId?: string;
}

/**
 * One entry on the rail. The connector is drawn from each node down to the next
 * rather than as one line behind the list, so a node of any height stays joined
 * to its neighbour without measuring anything.
 */
function TimelineNode({ icon, iconBg, continues, children, testId }: TimelineNodeProps) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-testid={testId}>
      {continues && <span aria-hidden className="absolute left-4 top-9 bottom-0 w-px -translate-x-1/2 bg-border" />}
      <span className={cn("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", iconBg)}>
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </li>
  );
}

function StepNode({ step, continues }: { step: TimelineStep; continues: boolean }) {
  const style = TONE_STYLE[step.tone];
  const Icon = style.icon;
  return (
    <TimelineNode
      icon={<Icon className={cn("h-4 w-4", style.color, style.spin && "animate-spin")} />}
      iconBg={style.bg}
      continues={continues}
      testId={`alert-history-step-${step.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{step.label}</span>
        <Badge variant="secondary" className={cn("text-[10px]", style.color)}>
          {step.status}
        </Badge>
        {step.attempt > 1 && <span className="text-xs text-muted-foreground">attempt {step.attempt}</span>}
        {step.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">{formatDuration(step.durationMs)}</span>
        )}
      </div>

      {step.error && (
        <div className="mt-1.5 text-xs">
          {/* Readable copy when the reason is one we recognise, with the raw
              reason underneath -- the advice alone would hide what the engine
              actually said. */}
          <p className="font-medium text-red-500">{step.failure?.title ?? step.error}</p>
          {step.failure && (
            <>
              <p className="mt-0.5 text-muted-foreground">{step.failure.hint}</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{step.error}</p>
            </>
          )}
        </div>
      )}

      {(step.inputs || step.outputs) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {step.inputs && <WebhookEventPayloadDialog eventType={`${step.taskId} · inputs`} payload={step.inputs} />}
          {step.outputs && <WebhookEventPayloadDialog eventType={`${step.taskId} · outputs`} payload={step.outputs} />}
        </div>
      )}
    </TimelineNode>
  );
}

interface RunTimelineProps {
  instanceId: Id<"instances">;
  engineRunId: string;
  /** Controls rendered under the header, such as replay. */
  actions?: (run: { failedStepTaskId: string | null }) => ReactNode;
}

/** The trigger that started a run, then every step it took, in order. */
export function RunTimeline({ instanceId, engineRunId, actions }: RunTimelineProps) {
  const data = useQuery(api.workflowRuns.runWithSteps, { instanceId, engineRunId });
  const timeline = useMemo(() => (data ? buildTimeline(data.run, data.steps) : null), [data]);

  if (data === undefined) {
    return (
      <div className="space-y-4 p-4" data-testid="alert-history-timeline-loading">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (data === null || timeline === null) {
    return <p className="p-4 text-sm text-muted-foreground">This run is no longer available.</p>;
  }

  const { run } = data;
  const runStyle = TONE_STYLE[timeline.tone];

  return (
    <div className="p-4" data-testid="alert-history-timeline">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{run.workflowName ?? run.workflowId}</h2>
        <Badge variant="secondary" className={cn("text-xs", runStyle.color)}>
          {run.status}
        </Badge>
        {timeline.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">{formatDuration(timeline.durationMs)}</span>
        )}
        {run.startedAt && (
          <span className="text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        )}
      </div>

      {run.error && !timeline.failedStep && (
        // A run can fail before any step does -- a dependency graph it cannot
        // build, for one -- and then no step carries the reason.
        <p className="mb-4 text-xs text-red-500">{run.error}</p>
      )}

      {actions && <div className="mb-4">{actions({ failedStepTaskId: timeline.failedStep?.taskId ?? null })}</div>}

      <ol>
        <TimelineNode
          icon={<Zap className="h-4 w-4 text-amber-500" />}
          iconBg="bg-amber-500/10"
          continues={timeline.steps.length > 0}
          testId="alert-history-trigger"
        >
          {timeline.trigger ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{timeline.trigger.type}</span>
                {(timeline.trigger.platform ?? timeline.trigger.source) && (
                  <Badge variant="outline" className="text-[10px]">
                    {timeline.trigger.platform ?? timeline.trigger.source}
                  </Badge>
                )}
              </div>
              <div className="mt-1">
                <WebhookEventPayloadDialog eventType={timeline.trigger.type} payload={timeline.trigger.payload} />
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Trigger event not recorded</span>
          )}
        </TimelineNode>

        {timeline.steps.map((step, index) => (
          <StepNode key={step.key} step={step} continues={index < timeline.steps.length - 1} />
        ))}
      </ol>

      {timeline.steps.length === 0 && run.status === "running" && (
        <p className="mt-2 text-xs text-muted-foreground">Waiting for the first step to report…</p>
      )}
    </div>
  );
}
