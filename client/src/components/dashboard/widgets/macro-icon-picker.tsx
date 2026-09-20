import { Check, ChevronsUpDown } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listLucideIconNames, resolveLucideIcon } from "@/lib/resolve-lucide-icon";
import { cn } from "@/lib/utils";

// Shown before the user types anything — the long tail is reachable by search,
// but a pad button is almost always one of these.
const SUGGESTED_ICONS = [
  "MessageSquare",
  "Workflow",
  "Globe",
  "Zap",
  "Radio",
  "Megaphone",
  "Play",
  "Pause",
  "SkipForward",
  "Volume2",
  "Mic",
  "MicOff",
  "Video",
  "Camera",
  "Music",
  "Bell",
  "Heart",
  "Star",
  "Gift",
  "Trophy",
  "Flame",
  "Sparkles",
  "PartyPopper",
  "ThumbsUp",
  "Coffee",
  "Gamepad2",
  "Timer",
  "Shield",
  "Ban",
  "UserPlus",
  "Users",
  "Eye",
  "Lightbulb",
  "Rocket",
  "Send",
  "Link",
  "Terminal",
  "Code",
  "Settings",
  "RefreshCw",
  "Power",
  "Bot",
  "Tv",
];

// cmdk filters and renders every mounted item, and Lucide ships well over a
// thousand — so filtering happens here and the result list is capped.
const MAX_RESULTS = 60;

interface MacroIconPickerProps {
  value?: string;
  onChange: (icon: string | undefined) => void;
  id?: string;
}

export function MacroIconPicker({ value, onChange, id }: MacroIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return SUGGESTED_ICONS;
    }
    const matches: string[] = [];
    for (const name of listLucideIconNames()) {
      if (name.toLowerCase().includes(trimmed)) {
        matches.push(name);
        if (matches.length === MAX_RESULTS) {
          break;
        }
      }
    }
    return matches;
  }, [query]);

  const SelectedIcon = value ? resolveLucideIcon(value) : null;

  const select = (icon: string | undefined) => {
    onChange(icon);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid="button-macro-icon-picker"
        >
          <span className="flex items-center gap-2">
            {SelectedIcon ? <SelectedIcon className="h-4 w-4" /> : null}
            {value ?? "Select an icon"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search icons…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No icon matches that.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => select(undefined)}>
                <span className="text-muted-foreground">No icon</span>
                {value === undefined && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={query.trim() ? "Results" : "Suggested"}>
              {results.map((name) => {
                const Icon = resolveLucideIcon(name);
                return (
                  <CommandItem key={name} value={name} onSelect={() => select(name)}>
                    <Icon className="mr-2 h-4 w-4" />
                    {name}
                    {value === name && <Check className="ml-auto h-4 w-4" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MacroIconPreview({
  icon,
  className,
  style,
}: {
  icon?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = resolveLucideIcon(icon ?? "Zap");
  return <Icon className={cn("h-6 w-6", className)} style={style} />;
}
