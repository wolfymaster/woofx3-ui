import { ChevronsRight, ListOrdered, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { type ResourceDetailProps, ResourceKindPage } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useResourceAction } from "@/hooks/use-resource-action";
import {
  QUEUE_MAX_ENTRY_LENGTH,
  QUEUE_REFUSAL_MESSAGES,
  queueAddRefusal,
  queueCapacity,
  queueEntries,
} from "@/lib/resource-values";

const BASE_PATH = "/stream/queues";

export default function Queues() {
  return (
    <ResourceKindPage
      kind="queue"
      title="Queues"
      description="Lines your viewers join: games with viewers, song requests, shoutouts. Work through them here, from a chat command, or from any workflow."
      icon={ListOrdered}
      basePath={BASE_PATH}
      railValue={({ value }) => queueEntries(value).length.toLocaleString()}
      detail={(props) => <QueuePanel {...props} />}
    />
  );
}

/** The queue's entries in order and what can be done to them, through the queue's own actions. */
function QueuePanel(props: ResourceDetailProps) {
  const { instance, value, settings } = props;
  const { run, pending } = useResourceAction(props);
  const [entry, setEntry] = useState("");

  const entries = queueEntries(value);
  const capacity = queueCapacity(settings);
  const trimmed = entry.trim();
  const refusal = trimmed === "" ? null : queueAddRefusal(entries, settings, trimmed);
  const canAdd = trimmed !== "" && trimmed.length <= QUEUE_MAX_ENTRY_LENGTH && refusal === null;

  return (
    <Card className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-queue-size">
          {entries.length.toLocaleString()} in line
          {Number(settings.capacity) >= 1 ? ` of ${capacity.toLocaleString()}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            disabled={pending !== null || entries.length === 0}
            onClick={() => void run("queue.next")}
            data-testid="button-queue-next"
          >
            <ChevronsRight className="h-4 w-4 mr-2" />
            Next
          </Button>
          <Button
            variant="ghost"
            disabled={pending !== null || entries.length === 0}
            onClick={() => void run("queue.clear")}
            data-testid="button-queue-clear"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          Nobody in line.
        </p>
      ) : (
        <ol className="divide-y rounded-md border" data-testid="list-queue-entries">
          {entries.map((item, index) => (
            // Entries may repeat when duplicates are allowed, so position is part of the key.
            <li key={`${index}:${item}`} className="flex items-center gap-3 px-3 py-2">
              <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{index + 1}</span>
              <span className={index === 0 ? "flex-1 break-all font-medium" : "flex-1 break-all"}>{item}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={pending !== null}
                onClick={() => void run("queue.remove", { entry: item })}
                aria-label={`Remove ${item}`}
                data-testid={`button-queue-remove-${index}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ol>
      )}

      <form
        className="space-y-1.5"
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
        <div className="flex items-center gap-2">
          <Input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            maxLength={QUEUE_MAX_ENTRY_LENGTH}
            placeholder="Add someone or something to the line"
            aria-invalid={refusal !== null}
            data-testid="input-queue-entry"
          />
          <Button type="submit" variant="outline" disabled={!canAdd || pending !== null}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>
        {refusal && <p className="text-xs text-destructive">{QUEUE_REFUSAL_MESSAGES[refusal]}</p>}
      </form>

      <p className="text-center text-xs text-muted-foreground">
        To let viewers join from chat, give a command the Add to queue action, choose {instance.displayName}, and set
        the entry to the viewer's name.
      </p>
    </Card>
  );
}
