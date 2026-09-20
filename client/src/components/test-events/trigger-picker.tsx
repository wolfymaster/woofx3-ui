import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AlertMenuSection } from "@/lib/alert-groups";
import { cn } from "@/lib/utils";
import type { TriggerPreset } from "@/lib/workflow-presets";

interface TriggerPickerProps {
  /** Every trigger that can be fired, in the rail's menu order — see flattenAlertTree. */
  sections: readonly AlertMenuSection[];
  selectedId: string | null;
  onSelect: (presetId: string) => void;
  /** Distinguishes this combobox from another on the same page. */
  id?: string;
}

/**
 * Which event to fire, searchable.
 *
 * Every trigger a module registers lands in this one list, so it is long, full
 * of near-identical names ("Channel subscribe", "Shared channel subscribe") and
 * grouped several levels deep — a plain select makes finding one a scroll
 * through headings. Typing matches the trigger's name, its menu path and its
 * event type, because someone hunting for a raid alert may know it by any of
 * the three.
 */
export function TriggerPicker({ sections, selectedId, onSelect, id = "test-event-trigger" }: TriggerPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = findSelected(sections, selectedId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto w-full justify-between py-2 font-normal"
          id={id}
          data-testid="select-test-event"
        >
          {selected ? (
            <span className="min-w-0 text-left">
              <span className="block truncate">{selected.preset.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{selected.section.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select a trigger…</span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search triggers…" data-testid="input-test-event-search" />
          <CommandList>
            <CommandEmpty>No trigger matches.</CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.id} heading={section.label}>
                {section.presets.map((preset) => (
                  <CommandItem
                    key={preset.id}
                    value={`${preset.name} ${section.label}`}
                    keywords={[preset.event ?? "", preset.description]}
                    onSelect={() => {
                      onSelect(preset.id);
                      setOpen(false);
                    }}
                    className="items-start gap-2"
                    data-testid={`option-test-event-${preset.id}`}
                  >
                    <Check className={cn("mt-0.5 h-4 w-4 shrink-0", preset.id === selectedId ? "" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block truncate">{preset.name}</span>
                      {preset.event && (
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {preset.event}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function findSelected(
  sections: readonly AlertMenuSection[],
  selectedId: string | null
): { preset: TriggerPreset; section: AlertMenuSection } | undefined {
  if (!selectedId) {
    return undefined;
  }
  for (const section of sections) {
    const preset = section.presets.find((entry) => entry.id === selectedId);
    if (preset) {
      return { preset, section };
    }
  }
  return undefined;
}
