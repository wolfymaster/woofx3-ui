import { Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { isHexColor, MACRO_COLOR_PRESETS } from "@/lib/macro-pad";
import { cn } from "@/lib/utils";

const FALLBACK_PICKER_COLOR = "#3b82f6";

interface MacroColorPickerProps {
  value?: string;
  onChange: (color: string | undefined) => void;
}

export function MacroColorPicker({ value, onChange }: MacroColorPickerProps) {
  // The text field holds whatever is being typed, including the half-written
  // states between two valid colors — only a complete value is committed.
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commitDraft = (next: string) => {
    setDraft(next);
    if (next.trim() === "") {
      onChange(undefined);
      return;
    }
    if (isHexColor(next)) {
      onChange(next);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          title="No color"
          aria-label="No color"
          aria-pressed={value === undefined}
          className={cn(
            "h-6 w-6 rounded-full border-2 flex items-center justify-center text-muted-foreground",
            value === undefined ? "border-foreground" : "border-transparent"
          )}
          onClick={() => onChange(undefined)}
          data-testid="swatch-macro-none"
        >
          <Ban className="h-3.5 w-3.5" />
        </button>

        {MACRO_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            title={preset.label}
            aria-label={preset.label}
            aria-pressed={value === preset.value}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-colors",
              value === preset.value ? "border-foreground" : "border-transparent"
            )}
            style={{ backgroundColor: preset.value }}
            onClick={() => onChange(preset.value)}
            data-testid={`swatch-macro-${preset.label.toLowerCase()}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label="Custom color"
          value={isHexColor(value) ? value : FALLBACK_PICKER_COLOR}
          onChange={(e) => commitDraft(e.target.value)}
          className="h-9 w-12 p-1 shrink-0"
          data-testid="input-macro-color-picker"
        />
        <Input
          value={draft}
          onChange={(e) => commitDraft(e.target.value)}
          placeholder="#3b82f6"
          className="font-mono text-sm"
          data-testid="input-macro-color-hex"
        />
      </div>
    </div>
  );
}
