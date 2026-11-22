import { CalendarClock } from "lucide-react";
import { useId } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ModuleResourceInstance } from "@/engine/types";
import { SCHEDULE_MAX_MINUTES, SCHEDULE_MIN_MINUTES, type ScheduleChoice } from "@/lib/command-schedule";
import { resourceName } from "@/lib/resource-instance";

const NONE = "none";
const NEW = "new";

/** What a schedule starts as when the streamer asks for a new one. */
const NEW_SCHEDULE: Extract<ScheduleChoice, { kind: "new" }> = {
  kind: "new",
  name: "",
  minutes: 15,
  runWhileOffline: false,
};

interface CommandScheduleCardProps {
  schedules: ModuleResourceInstance[];
  choice: ScheduleChoice;
  onChange: (choice: ScheduleChoice) => void;
  /** Why a schedule can't be offered on this engine; the card then only says so. */
  unavailable: string | null;
  /** What is wrong with the choice, shown under it once the streamer has tried to save. */
  problem: string | null;
}

/**
 * Runs the command's steps on a schedule, as though someone typed it, with no chatter and no
 * arguments. The streamer picks a schedule they already have, or makes one here.
 */
export function CommandScheduleCard({ schedules, choice, onChange, unavailable, problem }: CommandScheduleCardProps) {
  const id = useId();
  const selected = choice.kind === "existing" ? choice.canonicalId : choice.kind === "new" ? NEW : NONE;

  function pick(value: string) {
    if (value === NONE) {
      onChange({ kind: "none" });
    } else if (value === NEW) {
      onChange(choice.kind === "new" ? choice : NEW_SCHEDULE);
    } else {
      onChange({ kind: "existing", canonicalId: value });
    }
  }

  return (
    <Card className="space-y-4 p-4" data-testid="card-command-schedule">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">Schedule</h2>
          <p className="text-sm text-muted-foreground">
            Run this command's steps on a timer, with no one typing it. It runs for everyone, whoever may use it in
            chat.
          </p>
        </div>
      </div>

      {unavailable ? (
        <p className="text-sm text-muted-foreground" data-testid="text-command-schedule-unavailable">
          {unavailable}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-schedule`}>Runs on</Label>
            <Select value={selected} onValueChange={pick}>
              <SelectTrigger id={`${id}-schedule`} data-testid="select-command-schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not scheduled</SelectItem>
                {schedules.map((schedule) => (
                  <SelectItem key={schedule.canonicalId} value={schedule.canonicalId}>
                    {resourceName(schedule)}
                  </SelectItem>
                ))}
                <SelectItem value={NEW}>A new schedule…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {choice.kind === "new" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input
                  id={`${id}-name`}
                  value={choice.name}
                  placeholder="Hourly reminders"
                  onChange={(event) => onChange({ ...choice, name: event.target.value })}
                  data-testid="input-command-schedule-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-minutes`}>Runs every (minutes)</Label>
                <Input
                  id={`${id}-minutes`}
                  type="number"
                  inputMode="numeric"
                  min={SCHEDULE_MIN_MINUTES}
                  max={SCHEDULE_MAX_MINUTES}
                  value={Number.isNaN(choice.minutes) ? "" : choice.minutes}
                  onChange={(event) => onChange({ ...choice, minutes: event.target.valueAsNumber })}
                  data-testid="input-command-schedule-minutes"
                />
              </div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <Label htmlFor={`${id}-offline`} className="font-normal">
                  Also run while I'm offline
                </Label>
                <Switch
                  id={`${id}-offline`}
                  checked={choice.runWhileOffline}
                  onCheckedChange={(runWhileOffline) => onChange({ ...choice, runWhileOffline })}
                  data-testid="switch-command-schedule-offline"
                />
              </div>
            </div>
          )}

          {problem && (
            <p className="text-sm text-destructive" data-testid="text-command-schedule-problem">
              {problem}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
