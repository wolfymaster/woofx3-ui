import { Search } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { dashboardWidgetsByCategory } from "@/lib/dashboard-widgets/registry";

interface WidgetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Says where the widget will go, e.g. "Add a widget to the rail". */
  title: string;
  onSelect: (type: string) => void;
}

function matches(query: string, label: string, description: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || label.toLowerCase().includes(needle) || description.toLowerCase().includes(needle);
}

/**
 * Every dashboard widget as a card with its description, so choosing one does
 * not mean knowing it by name. Picking a card closes the dialog.
 */
export function WidgetPickerDialog({ open, onOpenChange, title, onSelect }: WidgetPickerDialogProps) {
  const [query, setQuery] = useState("");

  const groups = dashboardWidgetsByCategory()
    .map((group) => ({
      ...group,
      widgets: group.widgets.filter((widget) => matches(query, widget.label, widget.description)),
    }))
    .filter((group) => group.widgets.length > 0);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pick a widget. You can move, resize or remove it until you save.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search widgets"
            className="pl-8"
            data-testid="input-search-widgets"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1">
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No widget matches "{query.trim()}".</p>
          )}
          {groups.map((group) => (
            <section key={group.category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {group.widgets.map((widget) => (
                  <button
                    key={widget.type}
                    type="button"
                    onClick={() => {
                      onSelect(widget.type);
                      handleOpenChange(false);
                    }}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`widget-option-${widget.type}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <widget.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium">{widget.label}</span>
                      <span className="block text-xs text-muted-foreground">{widget.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
