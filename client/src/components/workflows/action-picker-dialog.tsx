import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/components/common/help-tip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type ActionMenuGroup,
  ALL_SECTIONS,
  actionMenuGroups,
  actionSectionCounts,
  flattenActionMenu,
} from "@/lib/action-menu";
import { cn } from "@/lib/utils";
import type { ActionPreset } from "@/lib/workflow-presets";

interface ActionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionPresets: ActionPreset[];
  onSelect: (preset: ActionPreset) => void;
}

/**
 * The one place an action is chosen, from the workflow builder and from an alert's
 * trigger card alike.
 *
 * The catalog is listed by each action's declared taxonomy: the rail holds sections
 * (Built-in, Platforms, ...) and the list headings within them (Platforms › OBS), so
 * actions doing the same kind of thing sit together whichever module ships them. An
 * action declaring none is listed under its module (see `actionPlacement`). The
 * engine's `category` and icon are the same for every action, so neither is used. A
 * row is one line with its description beside the name, and the highlighted
 * action's description is repeated in full below, so a long catalog stays scannable
 * without hiding what each action does.
 */
export function ActionPickerDialog({ open, onOpenChange, actionPresets, onSelect }: ActionPickerDialogProps) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<string>(ALL_SECTIONS);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSection(ALL_SECTIONS);
      setActiveIndex(0);
    }
  }, [open]);

  const sections = useMemo(() => actionSectionCounts(actionPresets, search), [actionPresets, search]);
  // A search with no hits in the chosen section would otherwise show an empty list
  // beside a rail saying where the hits are.
  const effectiveSection = sections.some((entry) => entry.key === section) ? section : ALL_SECTIONS;
  const groups = useMemo(
    () => actionMenuGroups(actionPresets, search, effectiveSection),
    [actionPresets, search, effectiveSection]
  );
  const headings = useMemo(
    () => groups.map((group, index) => groupHeading(group, groups[index - 1], effectiveSection === ALL_SECTIONS)),
    [groups, effectiveSection]
  );
  const items = useMemo(() => flattenActionMenu(groups), [groups]);
  const activePosition = Math.min(activeIndex, items.length - 1);
  const active = items[activePosition];
  const matchCount = sections.reduce((total, entry) => total + entry.count, 0);
  const optionId = (preset: ActionPreset) => `action-option-${preset.id}`;

  useEffect(() => {
    if (active) {
      document.getElementById(`action-option-${active.id}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const handleSelect = (preset: ActionPreset) => {
    onSelect(preset);
    onOpenChange(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) {
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activePosition + step + items.length) % items.length);
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      handleSelect(active);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-3xl flex-col gap-0 p-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-1.5">
            Choose an action
            <HelpTip term="action" />
          </DialogTitle>
          <DialogDescription>Pick what this step should do.</DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0 px-6 pb-4">
          <Search className="absolute left-9 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search actions..."
            className="pl-9"
            data-testid="input-action-picker-search"
          />
        </div>

        <div className="flex min-h-0 flex-1 border-t">
          {sections.length > 1 && (
            <ScrollArea className="w-48 shrink-0 border-r">
              <div className="space-y-0.5 p-2">
                <SectionButton
                  label="All actions"
                  count={matchCount}
                  isSelected={effectiveSection === ALL_SECTIONS}
                  onClick={() => {
                    setSection(ALL_SECTIONS);
                    setActiveIndex(0);
                  }}
                />
                {sections.map((entry) => (
                  <SectionButton
                    key={entry.key}
                    label={entry.label}
                    count={entry.count}
                    isSelected={effectiveSection === entry.key}
                    onClick={() => {
                      setSection(entry.key);
                      setActiveIndex(0);
                    }}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          <ScrollArea className="flex-1">
            <div className="space-y-4 p-2">
              {groups.map((group, index) => (
                <div key={group.groupKey}>
                  {headings[index] && (
                    <h3 className="mb-1 px-2 text-xs font-medium text-muted-foreground">{headings[index]}</h3>
                  )}
                  <div className="space-y-0.5">
                    {group.actions.map((preset) => (
                      <button
                        key={preset.id}
                        id={optionId(preset)}
                        type="button"
                        className={cn(
                          "flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left",
                          preset === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                        )}
                        onMouseMove={() => {
                          if (preset !== active) {
                            setActiveIndex(items.indexOf(preset));
                          }
                        }}
                        onClick={() => handleSelect(preset)}
                        data-testid={`button-action-${preset.id}`}
                      >
                        <span className="shrink-0 text-sm">{preset.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{preset.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {actionPresets.length === 0
                    ? "No actions available. Install a module that provides actions."
                    : `No actions match "${search}".`}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-start gap-4 border-t px-6 py-3">
          <div className="min-w-0 flex-1">
            {active ? (
              <>
                <p className="line-clamp-2 text-xs">{active.description || "No description."}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{actionShape(active)}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing to add.</p>
            )}
          </div>
          <p className="shrink-0 space-x-2 text-[10px] text-muted-foreground">
            <span>↑↓ move</span>
            <span>↵ add</span>
            <span>esc close</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionButton({
  label,
  count,
  isSelected,
  onClick,
}: {
  label: string;
  count: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
      onClick={onClick}
      data-testid={`button-action-section-${label}`}
    >
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

/**
 * The heading over a group, or nothing. With every section listed, a section's first
 * group names the section and its own heading (Platforms › OBS) and later groups their
 * own heading. A group with no heading of its own (a module's section, or a one-segment
 * taxonomy) opening its section shows the section label alone, or nothing once the
 * rail has narrowed the list to that section and already names it.
 */
function groupHeading(
  group: ActionMenuGroup,
  previous: ActionMenuGroup | undefined,
  showSection: boolean
): string | null {
  const hasOwnHeading = group.groupLabel !== group.sectionLabel;
  const startsSection = previous?.sectionKey !== group.sectionKey;
  if (!startsSection) {
    return group.groupLabel;
  }
  if (showSection) {
    return hasOwnHeading ? `${group.sectionLabel} › ${group.groupLabel}` : group.sectionLabel;
  }
  return hasOwnHeading ? group.groupLabel : null;
}

/** What the highlighted action asks for and hands back, as one line. */
function actionShape(preset: ActionPreset): string {
  const settings = preset.config?.fields.length ?? 0;
  const outputs = preset.config?.outputs ?? [];
  const parts = [settings === 1 ? "1 setting" : `${settings} settings`];
  if (outputs.length > 0) {
    parts.push(`returns ${outputs.map((output) => output.path).join(", ")}`);
  }
  return `${preset.source} · ${parts.join(" · ")}`;
}
