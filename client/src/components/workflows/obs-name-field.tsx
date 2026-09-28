import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInstance } from "@/hooks/use-instance";
import { useObsScenes } from "@/hooks/use-obs-scenes";
import { obsNameGroups, obsNameMismatch, obsNameSourceOf } from "@/lib/obs-name-fields";
import { cn } from "@/lib/utils";

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
  const source = obsNameSourceOf(field);
  if (!source) {
    throw new Error(`ObsNameField: field "${field.id}" carries no OBS name source`);
  }

  const text = typeof value === "string" ? value : "";
  const scenes = obs.listing?.available ? obs.listing.scenes : [];
  const groups = obs.listing?.available ? obsNameGroups(scenes, source, values) : [];
  const mismatch = obs.listing?.available ? obsNameMismatch(text, scenes, source, values) : null;
  const pickable = groups.length > 0;

  let status: string | null = null;
  if (obs.error !== null) {
    status = `Could not ask OBS for names: ${obs.error}`;
  } else if (obs.listing && !obs.listing.available) {
    status = `Names from OBS are unavailable: ${obs.listing.reason}. Type the name exactly as OBS shows it.`;
  } else if (obs.listing?.available && !pickable) {
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
            data-testid={`input-${field.id}`}
          />
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              role="combobox"
              aria-expanded={open}
              aria-label={`Pick ${field.label.toLowerCase()} from OBS`}
              title="Pick from OBS"
              disabled={!pickable}
              className="shrink-0"
              data-testid={`button-pick-${field.id}`}
            >
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Search OBS..." />
              <CommandList>
                <CommandEmpty>No matching names.</CommandEmpty>
                {groups.map((group) => (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.names.map((name) => (
                      <CommandItem
                        key={name}
                        // cmdk dedupes items by value, and a source can sit in several scenes.
                        value={`${group.heading}\u0000${name}`}
                        keywords={[name]}
                        onSelect={() => {
                          onChange(name);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("h-4 w-4", name === text ? "opacity-100" : "opacity-0")} />
                        {name}
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
      {mismatch !== null && (
        <p className="text-xs text-amber-600 dark:text-amber-300" data-testid={`warning-${field.id}`}>
          {mismatch}
        </p>
      )}
      {status !== null && (
        <p className="text-xs text-muted-foreground" data-testid={`status-${field.id}`}>
          {status}
        </p>
      )}
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  );
}

export const ObsNameFieldRenderer: CustomFieldRenderer = (props) => <ObsNameField {...props} />;
