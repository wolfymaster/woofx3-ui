import { isFailureStatus } from "@convex/lib/engineAlertLifecycle";
import { Info, ListFilter, Loader2, Radio, RotateCcw, ScrollText, Star } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { AlertQueueControls } from "@/components/alerts/alert-queue-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEngineScope } from "@/engine/context";
import { useEngineAlerts } from "@/engine/hooks/use-alert-queue";
import { type EventLogStatus, useEventLog } from "@/engine/hooks/use-event-log";
import { type EventLogSettingsHandle, useEventLogSettings } from "@/engine/hooks/use-event-log-settings";
import { useReplayAlert } from "@/engine/hooks/use-replay-alert";
import type { EngineAlert } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { type ActivityRow, eventTypeGroups, mergeActivity, triggersByEventType } from "@/lib/activity-feed";
import { describeAlertFailure } from "@/lib/alert-failure";
import { alertRunPath } from "@/lib/alert-run-route";
import { engineAlertStyle } from "@/lib/alert-status";
import { type AlertSummary, describeAlert, describeEvent, eventFieldRows } from "@/lib/alert-summary";
import type { DashboardWidgetProps } from "@/lib/dashboard-widgets/types";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import type { TriggerPreset } from "@/lib/workflow-presets";

const ALERT_LIMIT = 50;

export type EventsRow = ActivityRow<EngineAlert>;

function describeRow(row: EventsRow, trigger: TriggerPreset | undefined): AlertSummary {
  if (row.event) {
    return describeEvent(row.event, trigger);
  }
  return describeAlert(row.alerts[0]?.payload, undefined);
}

interface EventsWidgetProps extends DashboardWidgetProps {
  /**
   * When set, each row gets a save-as-highlight action. Omitted on the standalone
   * widget: only the Activity panel has somewhere to put a saved highlight.
   */
  onSaveHighlight?: (row: EventsRow, summary: AlertSummary) => void;
}

/**
 * One feed of what happened on stream: every alert, and every event of a type
 * the engine's selection enables, each worded by its trigger's summary. See
 * lib/activity-feed.ts for how the rows are built.
 *
 * Takes no widget config: which types show is the engine's, shared by every
 * Events widget on it.
 */
export function EventsWidget({ onSaveHighlight }: EventsWidgetProps) {
  const { instanceId } = useEngineScope();
  const { triggerPresets } = useWorkflowCatalog();
  const byEvent = useMemo(() => triggersByEventType(triggerPresets), [triggerPresets]);
  const selection = useEventLogSettings();
  const settings = selection.state;

  // Undefined until the selection is known; null for an engine without one,
  // which then pushes its own fixed set and every pushed event shows.
  const enabled =
    settings.status === "ready" ? settings.settings.enabled : settings.status === "unsupported" ? null : undefined;
  const enabledTypes = useMemo(() => (enabled === null ? null : new Set(enabled ?? [])), [enabled]);

  const alerts = useEngineAlerts(ALERT_LIMIT);
  const { events, status } = useEventLog(enabled);
  const rows = useMemo(() => mergeActivity(events, alerts ?? [], enabledTypes), [events, alerts, enabledTypes]);

  const failures = rows.filter((row) => row.alerts[0] && isFailureStatus(row.alerts[0].status)).length;
  const historyStatus: EventLogStatus = settings.status === "error" ? "error" : status;
  const loading = alerts === undefined || historyStatus === "loading";

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {rows.length} recent
          </Badge>
          {failures > 0 && (
            <Badge variant="secondary" className="text-xs text-red-500">
              {failures} failed
            </Badge>
          )}
          <HistoryNote status={historyStatus} />
        </div>
        <div className="flex items-center gap-1">
          {instanceId && <AlertQueueControls />}
          {instanceId && <EventsFilterButton selection={selection} byEvent={byEvent} />}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {!instanceId ? (
            <EmptyFeed>No instance connected</EmptyFeed>
          ) : rows.length === 0 && loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyFeed>Nothing has happened yet</EmptyFeed>
          ) : (
            rows.map((row) => {
              const trigger = row.event?.type ? byEvent.get(row.event.type) : undefined;
              return (
                <EventsRowItem
                  key={row.key}
                  row={row}
                  trigger={trigger}
                  summary={describeRow(row, trigger)}
                  onSaveHighlight={onSaveHighlight}
                />
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyFeed({ children }: { children: string }) {
  return (
    <div className="py-8 text-center">
      <Radio className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** Says why the feed holds only what arrived since the page loaded, when it does. */
function HistoryNote({ status }: { status: EventLogStatus }) {
  if (status !== "unsupported" && status !== "error") {
    return null;
  }
  const reason =
    status === "unsupported"
      ? "Your engine is too old to keep an event log. Update it to see events from before this page loaded."
      : "The engine's event log could not be read. Events from before this page loaded will show after it reconnects.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="text-xs text-muted-foreground" data-testid="badge-events-live-only">
          Live only
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}

/** Why the filter cannot be used, or null when it can. */
function filterUnavailableReason(state: EventLogSettingsHandle["state"]): string | null {
  switch (state.status) {
    case "ready":
      return null;
    case "loading":
      return "Reading which events your engine records…";
    case "error":
      return "Your engine's event choices could not be read. They will be read again when it reconnects.";
    case "unsupported":
      return state.checked === "outdated"
        ? "Update your engine to choose which events show here."
        : "Your engine could not be asked whether it lets you choose which events show.";
  }
}

interface EventsFilterButtonProps {
  selection: EventLogSettingsHandle;
  byEvent: ReadonlyMap<string, TriggerPreset>;
}

function EventsFilterButton({ selection, byEvent }: EventsFilterButtonProps) {
  const { state, saving, refresh, setEnabled } = selection;
  const { toast } = useToast();
  const settings = state.status === "ready" ? state.settings : null;
  const groups = useMemo(() => (settings ? eventTypeGroups(settings.offered, byEvent) : []), [settings, byEvent]);
  const enabled = useMemo(() => new Set(settings?.enabled ?? []), [settings]);
  const unavailable = filterUnavailableReason(state);

  if (unavailable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button fires no pointer events, so the span carries the tooltip. */}
          <span tabIndex={unavailable ? 0 : undefined} className="inline-flex">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled data-testid="button-events-filter">
              <ListFilter className="h-3.5 w-3.5" />
              <span className="sr-only">Choose which events show</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{unavailable}</TooltipContent>
      </Tooltip>
    );
  }

  const toggle = (type: string, on: boolean) => {
    setEnabled(type, on).catch((err: unknown) => {
      toast({
        title: "Could not save your event choice",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    });
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          refresh();
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" data-testid="button-events-filter">
              <ListFilter className="h-3.5 w-3.5" />
              <span className="sr-only">Choose which events show</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Choose which events show</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-0" data-testid="popover-events-filter">
        <div className="px-3 pt-3 pb-2 space-y-1 text-xs text-muted-foreground">
          <p>Alerts always show. These choose which other events your engine records and shows.</p>
          <p>
            Turning one on records it from now on; earlier ones do not fill in. The choice applies to every Events
            widget on this engine.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto px-3 pb-3 space-y-3">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No modules with events installed.</p>}
          {groups.map((group) => (
            <div key={group.source}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{group.source}</p>
              {group.types.map((option) => {
                const id = `events-filter-${option.type}`;
                return (
                  <label key={option.type} htmlFor={id} className="flex items-center gap-2 py-1 text-sm">
                    <Checkbox
                      id={id}
                      checked={enabled.has(option.type)}
                      disabled={saving}
                      onCheckedChange={(checked) => toggle(option.type, checked === true)}
                    />
                    <span className="truncate" title={option.type}>
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface EventsRowItemProps {
  row: EventsRow;
  trigger: TriggerPreset | undefined;
  summary: AlertSummary;
  onSaveHighlight?: (row: EventsRow, summary: AlertSummary) => void;
}

function EventsRowItem({ row, trigger, summary, onSaveHighlight }: EventsRowItemProps) {
  const alert = row.alerts[0];
  const style = alert ? engineAlertStyle(alert) : null;
  const Icon = style?.icon ?? trigger?.icon ?? Radio;
  const failure = alert?.error ? describeAlertFailure(alert.error) : null;

  return (
    <div
      className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors"
      data-testid={`events-row-${row.key}`}
    >
      <div
        className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-0.5", style?.bg ?? "bg-muted")}
      >
        <Icon className={cn("h-4 w-4", style?.color ?? "text-primary")} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" title={summary.title}>
          {summary.title}
        </p>
        {summary.details.length > 0 && (
          <p className="text-xs text-foreground/80 truncate" title={summary.details.join("\n")}>
            {summary.details.join(" · ")}
          </p>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{formatTimeAgo(new Date(row.time).toISOString())}</span>
          {trigger?.source && (
            <>
              <span>·</span>
              <span className="truncate">{trigger.source}</span>
            </>
          )}
        </div>
        {/* The readable title on the row; the advice and the original
            technical reason both on hover. Falls back to the raw reason for a
            failure the mapping does not know. */}
        {alert?.error && style && (
          <p
            className={cn("text-xs truncate mt-0.5", style.color)}
            title={[failure?.hint, alert.error].filter(Boolean).join("\n\n")}
          >
            {failure?.title ?? alert.error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {alert && style ? (
          <>
            <Badge variant="secondary" className={cn("text-[10px]", style.color)}>
              {style.label}
            </Badge>
            {row.alerts.length > 1 && (
              <Badge variant="outline" className="text-[10px]">
                {row.alerts.length} alerts
              </Badge>
            )}
            <AlertRowActions alert={alert} />
          </>
        ) : (
          <EventDetailsButton row={row} trigger={trigger} title={summary.title} />
        )}
        {onSaveHighlight && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onSaveHighlight(row, summary)}
            data-testid={`button-save-highlight-${row.key}`}
          >
            <Star className="h-3.5 w-3.5" />
            <span className="sr-only">Save as a highlight</span>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Replay and "open run" for the newest alert of a row. */
function AlertRowActions({ alert }: { alert: EngineAlert }) {
  const { replay, busy } = useReplayAlert();
  return (
    <>
      {/* `workflowId` on an alert row is the execution that fired it, which is
          what a run is keyed on. Absent for a manual dispatch. */}
      {alert.workflowId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon" variant="ghost" className="h-7 w-7">
              <Link href={alertRunPath(alert.workflowId)}>
                <ScrollText className="h-3.5 w-3.5" />
                <span className="sr-only">Open the run that fired this</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open the run that fired this</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={busy}
            onClick={() => void replay(alert.engineAlertId)}
            data-testid={`button-replay-alert-${alert.id}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            <span className="sr-only">Play this alert again</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Play this alert again</TooltipContent>
      </Tooltip>
    </>
  );
}

/**
 * An event's fields, labelled from its trigger's `emits`. A popover rather
 * than an expanding row: a dashboard widget keeps one layout (see
 * docs/patterns/dashboard-widgets.md).
 */
function EventDetailsButton({
  row,
  trigger,
  title,
}: {
  row: EventsRow;
  trigger: TriggerPreset | undefined;
  title: string;
}) {
  const fields = eventFieldRows(row.event?.data ?? null, trigger?.emits);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-event-details-${row.key}`}>
          <Info className="h-3.5 w-3.5" />
          <span className="sr-only">Show this event's details</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-sm font-medium mb-1">{title}</p>
        <p className="text-xs text-muted-foreground mb-2">{trigger?.name ?? row.event?.type}</p>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">This event carries no details.</p>
        ) : (
          <dl className="max-h-64 overflow-y-auto space-y-1 text-xs">
            {fields.map((field) => (
              <div key={field.path} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                <dt className="text-muted-foreground truncate" title={field.path}>
                  {field.label}
                </dt>
                <dd className="break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </PopoverContent>
    </Popover>
  );
}
