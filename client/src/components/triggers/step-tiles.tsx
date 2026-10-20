import { useMemo } from "react";
import { stepIcon } from "@/components/triggers/action-row";
import { actionGroupHeading, actionMenuGroups } from "@/lib/action-menu";
import type { ActionPreset } from "@/lib/workflow-presets";

interface StepTilesProps {
  actionPresets: ActionPreset[];
  onAdd: (preset: ActionPreset) => void;
}

/**
 * Every action in the catalog as a tile, always on show, so adding a step is one click
 * and never a menu to open first. Grouped, ordered and headed as the action picker lists
 * them, by purpose (Workflow, Chat, Stream tools › Counters, ...), so a long catalog
 * reads as a few short sections instead of one undifferentiated grid.
 */
export function StepTiles({ actionPresets, onAdd }: StepTilesProps) {
  const groups = useMemo(() => actionMenuGroups(actionPresets, ""), [actionPresets]);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No actions are installed. Install a module that provides one.</p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group, index) => (
        <section key={group.groupKey} aria-label={group.groupLabel}>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            {actionGroupHeading(group, groups[index - 1])}
          </h4>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {group.actions.map((preset) => (
              <StepTile key={preset.id} preset={preset} onAdd={onAdd} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StepTile({ preset, onAdd }: { preset: ActionPreset; onAdd: (preset: ActionPreset) => void }) {
  const Icon = stepIcon({ handlerType: preset.handlerType ?? "function" }, preset);
  return (
    <button
      type="button"
      onClick={() => onAdd(preset)}
      className="flex min-h-[104px] flex-col items-start gap-3 rounded-xl border bg-muted/30 p-3.5 text-left hover:border-foreground/20 hover:bg-accent sm:min-h-[112px]"
      data-testid={`add-step-${preset.id}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary/15 text-primary-text">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{preset.name}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{preset.description}</span>
      </span>
    </button>
  );
}
