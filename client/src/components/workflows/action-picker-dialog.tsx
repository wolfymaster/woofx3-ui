import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActionPreset } from "@/lib/workflow-presets";
import { PresetCard } from "./preset-card";

interface ActionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionPresets: ActionPreset[];
  onSelect: (preset: ActionPreset) => void;
}

export function ActionPickerDialog({ open, onOpenChange, actionPresets, onSelect }: ActionPickerDialogProps) {
  const [search, setSearch] = useState("");

  const categories = useMemo(() => Array.from(new Set(actionPresets.map((a) => a.category))).sort(), [actionPresets]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return actionPresets;
    }
    return actionPresets.filter(
      (a) => a.name.toLowerCase().includes(term) || a.description.toLowerCase().includes(term)
    );
  }, [actionPresets, search]);

  const handleSelect = (preset: ActionPreset) => {
    onSelect(preset);
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Choose an action</DialogTitle>
          <DialogDescription>Pick what this step should do.</DialogDescription>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions..."
            className="pl-9"
            data-testid="input-action-picker-search"
          />
        </div>
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-6 pb-2">
            {categories.map((category) => {
              const categoryActions = filtered.filter((a) => a.category === category);
              if (categoryActions.length === 0) {
                return null;
              }
              return (
                <div key={category}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">{category}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {categoryActions.map((action) => (
                      <PresetCard
                        key={action.id}
                        preset={action}
                        isSelected={false}
                        onClick={() => handleSelect(action)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No actions match "{search}".</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
