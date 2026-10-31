import { Play, Square } from "lucide-react";
import type { KindView } from "@/components/resources/kind-views";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useResourceAction } from "@/hooks/use-resource-action";
import { useNow } from "@/hooks/use-timer-state";
import {
  formatDuration,
  type ScheduleState,
  scheduleIntervalLabel,
  scheduleOfflineLabel,
  scheduleState,
} from "@/lib/resource-values";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";

/** A woofx3 schedule: when it runs next, started and stopped through the schedule's own actions. */
export const scheduleView: KindView = {
  description:
    "Things that happen on a clock: a chat message every 15 minutes, a reminder every hour. Add what it should do under Schedule runs below, then start it.",
  icon: STREAM_OBJECT_ICONS.schedules,
  railValue: (props) => <ScheduleCountdown {...props} />,
  detail: (props) => <SchedulePanel {...props} />,
};

/** A schedule's live state from its stored value; only a running one needs the clock. */
function useScheduleState(value: unknown): ScheduleState {
  const now = useNow(scheduleState(value, 0).running);
  return scheduleState(value, now);
}

function ScheduleCountdown({ value }: ResourceDetailProps) {
  const { running, nextRunMs } = useScheduleState(value);
  return <>{running ? formatDuration(nextRunMs) : "Stopped"}</>;
}

function SchedulePanel(props: ResourceDetailProps) {
  const { value, settings } = props;
  const { run, pending } = useResourceAction(props);
  const { running, nextRunMs, lastFiredAt } = useScheduleState(value);

  return (
    <Card className="p-6 space-y-6">
      <div className="space-y-3 text-center">
        <span className="block text-6xl font-semibold tabular-nums" data-testid="text-schedule-next">
          {running ? formatDuration(nextRunMs) : "Stopped"}
        </span>
        <span
          className="block text-xs uppercase tracking-wider text-muted-foreground"
          data-testid="text-schedule-interval"
        >
          {running ? "Until next run · " : ""}
          {scheduleIntervalLabel(settings)} · {scheduleOfflineLabel(settings)}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {running ? (
          <Button
            size="lg"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run("schedule.stop")}
            data-testid="button-schedule-stop"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        ) : (
          <Button
            size="lg"
            disabled={pending !== null}
            onClick={() => void run("schedule.start")}
            data-testid="button-schedule-start"
          >
            <Play className="h-4 w-4 mr-2" />
            Start
          </Button>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground" data-testid="text-schedule-last-run">
        {lastFiredAt === null ? "It has not run yet." : `Last ran ${new Date(lastFiredAt).toLocaleString()}.`}
      </p>
    </Card>
  );
}
