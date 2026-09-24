import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { ChevronsRight, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstance } from "@/hooks/use-instance";
import { useResourceAction } from "@/hooks/use-resource-action";
import type { DashboardWidgetProps } from "@/lib/dashboard-widgets/types";
import { type ResourceInstanceDoc, resourceName, resourceSettings } from "@/lib/resource-instance";
import {
  QUEUE_MAX_ENTRY_LENGTH,
  QUEUE_REFUSAL_MESSAGES,
  queueAddRefusal,
  queueCapacity,
  queueEntries,
} from "@/lib/resource-values";

const QUEUE_KIND = "queue";

const QUEUES_PATH = "/stream/queues";

/** Which queue the widget is showing, read out of its persisted config. */
function configuredCanonicalId(config: Record<string, unknown> | undefined): string | null {
  const canonicalId = config?.canonicalId;
  return typeof canonicalId === "string" && canonicalId !== "" ? canonicalId : null;
}

/**
 * One queue's line, with the same add and remove the Queues page offers.
 *
 * Both go through the queue's own engine actions (`useResourceAction`), never a
 * write to the mirrored value — so a change made here is the same change a chat
 * command or a workflow would make, and it comes back through the engine's
 * change event rather than being guessed at locally.
 */
export function QueueWidget({ config, onConfigChange }: DashboardWidgetProps) {
  const { instance } = useInstance();
  const instanceId = instance?._id;

  const kindDefinition = useQuery(
    api.resourceKinds.getForInstance,
    instanceId ? { instanceId, kind: QUEUE_KIND } : "skip"
  );
  const queues = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId ? { instanceId, kind: QUEUE_KIND } : "skip"
  );
  const values = useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId } : "skip");
  const refreshValues = useAction(api.moduleResourceActions.refreshResourceValues);

  // Entries arrive by webhook while the dashboard is open; this fills in any
  // written before it was, or while a webhook went missing.
  useEffect(() => {
    if (!instanceId) {
      return;
    }
    refreshValues({ instanceId, kind: QUEUE_KIND }).catch(() => {
      // The mirror still shows the last known line; the next change updates it.
    });
  }, [instanceId, refreshValues]);

  if (!instanceId || queues === undefined) {
    return <WidgetMessage>Loading…</WidgetMessage>;
  }

  if (queues.length === 0) {
    return (
      <WidgetMessage>
        No queues yet.{" "}
        <Link href={QUEUES_PATH} className="underline hover:text-foreground">
          Make one
        </Link>{" "}
        and it can show here.
      </WidgetMessage>
    );
  }

  const sorted = [...queues].sort((a, b) => resourceName(a).localeCompare(resourceName(b)));
  // An unset config, or one naming a queue since deleted, falls back to the
  // first rather than showing an empty frame — the widget is useful the moment
  // it is placed, and picking one is what writes the config.
  const selected = sorted.find((row) => row.canonicalId === configuredCanonicalId(config)) ?? sorted[0];

  return (
    <div className="flex flex-col h-full">
      <QueueHeader
        queues={sorted}
        selected={selected}
        onSelect={(canonicalId) => onConfigChange?.({ ...config, canonicalId })}
      />
      {/* Keyed so switching queue resets the draft entry and any in-flight disable. */}
      <QueueBody
        key={selected.canonicalId}
        queue={selected}
        moduleName={kindDefinition?.moduleName ?? selected.moduleName}
        value={values?.[selected.canonicalId] ?? null}
      />
    </div>
  );
}

function WidgetMessage({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center p-3 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function QueueHeader({
  queues,
  selected,
  onSelect,
}: {
  queues: ResourceInstanceDoc[];
  selected: ResourceInstanceDoc;
  onSelect: (canonicalId: string) => void;
}) {
  // One queue needs no chooser; a dropdown of a single option is a control that
  // can only tell you what you already see.
  if (queues.length === 1) {
    return (
      <div className="flex items-center px-3 py-2 border-b border-border shrink-0">
        <Link
          href={`${QUEUES_PATH}/${selected.resourceInstanceId}`}
          className="text-sm font-medium truncate hover:underline"
          data-testid="link-queue-widget-name"
        >
          {resourceName(selected)}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center px-2 py-1.5 border-b border-border shrink-0">
      <Select value={selected.canonicalId} onValueChange={onSelect}>
        <SelectTrigger className="h-7 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {queues.map((row) => (
            <SelectItem key={row.canonicalId} value={row.canonicalId}>
              {resourceName(row)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function QueueBody({ queue, moduleName, value }: { queue: ResourceInstanceDoc; moduleName: string; value: unknown }) {
  const { run, pending } = useResourceAction({ instance: queue, moduleName });
  const [entry, setEntry] = useState("");

  const settings = resourceSettings(queue);
  const entries = queueEntries(value);
  const capacity = queueCapacity(settings);
  const trimmed = entry.trim();
  const refusal = trimmed === "" ? null : queueAddRefusal(entries, settings, trimmed);
  const canAdd = trimmed !== "" && trimmed.length <= QUEUE_MAX_ENTRY_LENGTH && refusal === null;

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-queue-widget-size">
          {entries.length.toLocaleString()} in line
          {Number(settings.capacity) >= 1 ? ` of ${capacity.toLocaleString()}` : ""}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2 text-xs"
          disabled={pending !== null || entries.length === 0}
          onClick={() => void run("queue.next")}
          data-testid="button-queue-widget-next"
        >
          <ChevronsRight className="h-3.5 w-3.5 mr-1" />
          Next
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nobody in line.</p>
        ) : (
          <ol className="p-1" data-testid="list-queue-widget-entries">
            {entries.map((item, index) => (
              // Entries may repeat when duplicates are allowed, so position is part of the key.
              <li key={`${index}:${item}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className={index === 0 ? "flex-1 break-all text-sm font-medium" : "flex-1 break-all text-sm"}>
                  {item}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={pending !== null}
                  onClick={() => void run("queue.remove", { entry: item })}
                  aria-label={`Remove ${item} from the line`}
                  data-testid={`button-queue-widget-remove-${index}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </ScrollArea>

      <form
        className="border-t border-border p-2 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) {
            void run("queue.add", { entry: trimmed }).then((sent) => {
              if (sent) {
                setEntry("");
              }
            });
          }
        }}
      >
        <div className="flex items-center gap-1.5">
          <Input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            maxLength={QUEUE_MAX_ENTRY_LENGTH}
            placeholder="Add to the line"
            aria-invalid={refusal !== null}
            className="h-8 text-sm"
            data-testid="input-queue-widget-entry"
          />
          <Button
            type="submit"
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            disabled={!canAdd || pending !== null}
            aria-label="Add to the line"
            data-testid="button-queue-widget-add"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {refusal && <p className="mt-1 text-xs text-destructive">{QUEUE_REFUSAL_MESSAGES[refusal]}</p>}
      </form>
    </>
  );
}
