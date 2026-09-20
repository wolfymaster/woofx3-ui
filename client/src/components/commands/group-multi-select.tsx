import type { Doc } from "@convex/_generated/dataModel";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command as ComboBox,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { groupLabel, sortGroups } from "@/lib/group-display";
import { cn } from "@/lib/utils";

type GroupDoc = Doc<"chatCommandGroups">;

interface GroupMultiSelectProps {
  groups: GroupDoc[];
  /** The engineGroupId values currently granted. */
  selected: string[];
  onToggle: (engineGroupId: string) => void;
}

/** The groups a restricted command grants access to, picked from the instance's own. */
export function GroupMultiSelect({ groups, selected, onToggle }: GroupMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.engineGroupId, g])), [groups]);
  // Mirrors the Groups tab's split, so "which of these did I create?" is
  // answerable while granting rather than only while managing.
  const builtIn = useMemo(() => sortGroups(groups.filter((g) => g.isBuiltIn)), [groups]);
  const custom = useMemo(() => sortGroups(groups.filter((g) => !g.isBuiltIn)), [groups]);

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="justify-between font-normal">
            {selected.length > 0
              ? `${selected.length} group${selected.length === 1 ? "" : "s"} selected`
              : "Select groups..."}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <ComboBox>
            <CommandInput placeholder="Search groups..." />
            <CommandList>
              <CommandEmpty>No matching groups.</CommandEmpty>
              {builtIn.length > 0 && (
                <CommandGroup heading="Built-in">
                  {builtIn.map((group) => {
                    const isSelected = selected.includes(group.engineGroupId);
                    return (
                      <CommandItem
                        key={group.engineGroupId}
                        value={group.name}
                        onSelect={() => onToggle(group.engineGroupId)}
                      >
                        <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                        {groupLabel(group)}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {custom.length > 0 && (
                <CommandGroup heading="Custom">
                  {custom.map((group) => {
                    const isSelected = selected.includes(group.engineGroupId);
                    return (
                      <CommandItem
                        key={group.engineGroupId}
                        value={group.name}
                        onSelect={() => onToggle(group.engineGroupId)}
                      >
                        <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                        {groupLabel(group)}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </ComboBox>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1">
              {(() => {
                const g = groupsById.get(id);
                return g ? groupLabel(g) : id;
              })()}
              <button
                type="button"
                onClick={() => onToggle(id)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${groupsById.get(id)?.name ?? id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
