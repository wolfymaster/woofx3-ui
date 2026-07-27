import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ActionPreset, TriggerPreset } from "@/lib/workflow-presets";

interface PresetCardProps<T extends TriggerPreset | ActionPreset> {
  preset: T;
  isSelected: boolean;
  onClick: () => void;
}

export function PresetCard<T extends TriggerPreset | ActionPreset>({
  preset,
  isSelected,
  onClick,
}: PresetCardProps<T>) {
  const Icon = preset.icon;

  return (
    <Card
      className={cn(
        "p-4 cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary bg-primary/5"
      )}
      onClick={onClick}
      data-testid={`card-preset-${preset.id}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
            isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          <Icon className={cn("h-5 w-5", !isSelected && preset.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm">{preset.name}</h3>
            {isSelected && <Check className="h-4 w-4 text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{preset.description}</p>
        </div>
      </div>
    </Card>
  );
}
