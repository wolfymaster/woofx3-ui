import { ChevronLeft, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchWaitEvents, type WaitEventChoice, type WaitEventGroup } from "@/lib/wait-event";

/**
 * The catalog's events, first by what they are about (Twitch, Counters, …) and then by
 * name, with a search across all of them. Opens in place: under a wait's event button,
 * or as the first thing a new workflow asks for.
 */
export function EventCatalog({
  groups,
  onPick,
  onClose,
  legend,
  testId,
}: {
  groups: readonly WaitEventGroup[];
  onPick: (choice: WaitEventChoice) => void;
  onClose: () => void;
  /** What the list is for, read by screen readers ("Events to wait for"). */
  legend: string;
  /** Prefix of the list's test ids: `<testId>-catalog`, `button-<testId>-<trigger id>`, … */
  testId: string;
}) {
  const [query, setQuery] = useState("");
  const [groupKey, setGroupKey] = useState<string | null>(groups.length === 1 ? groups[0].key : null);
  const searchId = useId();
  const hits = searchWaitEvents(groups, query);
  const group = groups.find((candidate) => candidate.key === groupKey);

  const eventButton = (choice: WaitEventChoice) => (
    <li key={choice.row.id}>
      <button
        type="button"
        onClick={() => onPick(choice)}
        className="flex min-h-10 w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`button-${testId}-${choice.row.id}`}
      >
        <span className="text-sm font-medium">{choice.row.name}</span>
        {choice.row.description && (
          <span className="line-clamp-1 text-xs text-muted-foreground">{choice.row.description}</span>
        )}
      </button>
    </li>
  );

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-primary/30 bg-card p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      data-testid={`${testId}-catalog`}
    >
      <legend className="sr-only">{legend}</legend>
      <div className="flex items-center gap-2">
        {group && query === "" && (
          <Button type="button" variant="ghost" size="sm" className="gap-1 px-2" onClick={() => setGroupKey(null)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        )}
        <label htmlFor={searchId} className="sr-only">
          Find an event
        </label>
        <Input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an event"
          className="h-9"
          autoFocus
          data-testid={`input-${testId}-search`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={onClose}
          aria-label="Close the event list"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No modules with events are installed yet.</p>
      )}
      {query !== "" ? (
        hits.length === 0 ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Nothing matches.
          </p>
        ) : (
          <ul className="flex flex-col" aria-label="Matching events">
            {hits.map(eventButton)}
          </ul>
        )
      ) : group ? (
        <ul className="flex flex-col" aria-label={group.label}>
          {group.choices.map(eventButton)}
        </ul>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
          {groups.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              onClick={() => setGroupKey(candidate.key)}
              className="flex min-h-12 flex-col items-start justify-center rounded-lg px-2.5 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`button-${testId}-group-${candidate.key}`}
            >
              <span className="text-sm font-semibold">{candidate.label}</span>
              <span className="text-xs text-muted-foreground">
                {candidate.choices.length === 1 ? "1 event" : `${candidate.choices.length} events`}
              </span>
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
