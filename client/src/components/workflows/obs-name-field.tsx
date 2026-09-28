import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInstance } from "@/hooks/use-instance";
import { useObsScenes } from "@/hooks/use-obs-scenes";
import {
  liveSceneNote,
  obsNameGroups,
  obsNameMismatch,
  obsNameOptionLabel,
  obsNameSourceOf,
} from "@/lib/obs-name-fields";
import { cn } from "@/lib/utils";

/**
 * Items carry a value unique to their heading (a source can sit in several
 * scenes, and cmdk treats equal values as one item), so search matches on the
 * name alone, passed as the item's keywords, rather than on that value.
 */
function filterByName(_value: string, search: string, keywords?: string[]): number {
  const needle = search.toLowerCase();
  return (keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle)) ? 1 : 0;
}

/**
 * A name of something in the streamer's OBS: typed, or picked from what OBS
 * reports right now. Typing stays open so a variable, or a name for a scene not
 * made yet, can be saved; a typed name OBS does not have is flagged, since the
 * step would fail on it mid-stream.
 */
function ObsNameField({ field, value, onChange, availableVariables, values }: Parameters<CustomFieldRenderer>[0]) {
  const { instance } = useInstance();
  const obs = useObsScenes(instance?._id);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const noticeId = useId();
  const source = obsNameSourceOf(field);
  if (!source) {
    throw new Error(`ObsNameField: field "${field.id}" carries no OBS name source`);
  }

  const text = typeof value === "string" ? value : "";
  const available = obs.listing?.available === true;
  const scenes = obs.listing?.available ? obs.listing.scenes : [];
  const groups = available ? obsNameGroups(scenes, source, values) : [];
  const warning = available
    ? (obsNameMismatch(text, scenes, source, values) ?? liveSceneNote(text, scenes, source, values))
    : null;
  const pickable = groups.length > 0;
  const liveScene = source.kind === "obsSources" && (values[source.sceneField] ?? "") === "";

  let status: string | null = null;
  if (obs.loading && obs.listing === null) {
    status = "Asking OBS…";
  } else if (obs.error !== null) {
    status = `Could not ask OBS for names: ${obs.error}.`;
  } else if (obs.listing && !obs.listing.available) {
    status = `Names from OBS are unavailable: ${obs.listing.reason}. Type the name exactly as OBS shows it.`;
  } else if (available && !pickable) {
    status = "OBS reports nothing to pick here yet.";
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <VariableAwareInput
            id={field.id}
            value={text}
            onChange={onChange}
            placeholder={typeof field.placeholder === "string" ? field.placeholder : undefined}
            availableVariables={availableVariables}
            aria-describedby={noticeId}
            data-testid={`input-${field.id}`}
          />
        </div>
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              obs.revalidate();
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-controls={listId}
              aria-label={`Pick ${field.label.toLowerCase()} from OBS`}
              title="Pick from OBS"
              disabled={!instance}
              className="shrink-0"
              data-testid={`button-pick-${field.id}`}
            >
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <Command filter={filterByName}>
              <CommandInput placeholder="Search OBS..." />
              {liveScene && pickable && (
                <p className="px-3 pt-2 text-xs text-muted-foreground">
                  No scene is set, so the step acts on whichever scene is live. Sources are listed by scene, in OBS's
                  order.
                </p>
              )}
              <CommandList id={listId}>
                <CommandEmpty>{pickable ? "No matching names." : (status ?? "Nothing to pick.")}</CommandEmpty>
                {groups.map((group) => (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.options.map((option) => (
                      <CommandItem
                        key={option.name}
                        value={`${group.heading}\u0000${option.name}`}
                        keywords={[option.name]}
                        onSelect={() => {
                          onChange(option.name);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("h-4 w-4", option.name === text ? "opacity-100" : "opacity-0")} />
                        {obsNameOptionLabel(option)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Ask OBS again"
          title="Ask OBS again"
          disabled={!instance || obs.loading}
          onClick={obs.refresh}
          className="shrink-0"
          data-testid={`button-refresh-${field.id}`}
        >
          <RefreshCw className={cn("h-4 w-4", obs.loading && "animate-spin")} />
        </Button>
      </div>
      <output id={noticeId} className="block space-y-1">
        {warning !== null && (
          <p className="text-xs text-amber-600 dark:text-amber-300" data-testid={`warning-${field.id}`}>
            {warning}
          </p>
        )}
        {status !== null && (
          <p className="text-xs text-muted-foreground" data-testid={`status-${field.id}`}>
            {status}
          </p>
        )}
      </output>
      {typeof field.hint === "string" && <p className="text-xs text-muted-foreground">{field.hint}</p>}
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  );
}

export const ObsNameFieldRenderer: CustomFieldRenderer = (props) => <ObsNameField {...props} />;
