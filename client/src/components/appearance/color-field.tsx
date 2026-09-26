import { RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isHexColor } from "@/lib/theme/color";
import { cn } from "@/lib/utils";

interface ColorFieldProps {
  label: string;
  description: string;
  value: string;
  /** True when the value differs from the base palette, which enables reset. */
  modified: boolean;
  warning?: string;
  onChange: (hex: string) => void;
  onReset: () => void;
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isHexColor(hex) ? hex : null;
}

/**
 * A color picker paired with a hex field. The hex field keeps its own draft so
 * a half-typed value is not rejected mid-keystroke; it commits once it parses.
 */
export function ColorField({ label, description, value, modified, warning, onChange, onReset }: ColorFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = (next: string) => {
    setDraft(next);
    const hex = normalizeHex(next);
    if (hex) {
      onChange(hex);
    }
  };

  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          {label}
          {modified && <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Changed from base palette" />}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {warning && <p className="text-xs text-destructive">{warning}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
        />
        <Input
          id={id}
          value={draft}
          onChange={(event) => commitDraft(event.target.value)}
          onBlur={() => setDraft(value)}
          spellCheck={false}
          className={cn("w-28 font-mono text-sm", !normalizeHex(draft) && "border-destructive")}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onReset} disabled={!modified} aria-label={`Reset ${label}`}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset to base palette</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
