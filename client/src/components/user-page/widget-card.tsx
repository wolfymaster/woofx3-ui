import { PAGE_WIDGETS, type PageWidget } from "@shared/user-pages";
import { ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SortableItem } from "@/components/user-page/sortable";
import { WidgetConfigForm } from "@/components/user-page/widget-config-form";
import { fieldPath, type ProblemIndex } from "@/lib/page-problems";
import { widgetSummary } from "@/lib/user-page-widgets";
import { cn } from "@/lib/utils";

interface WidgetCardProps {
  widget: PageWidget;
  /** The widget's problem path: `sections[i].widgets[j]`. */
  path: string;
  problems: ProblemIndex;
  canDrag: boolean;
  /** Opens with its settings showing, as a widget just added does. */
  startOpen: boolean;
  onChange: (widget: PageWidget) => void;
  onRemove: () => void;
}

export function WidgetCard({ widget, path, problems, canDrag, startOpen, onChange, onRemove }: WidgetCardProps) {
  const [open, setOpen] = useState(startOpen);
  const definition = PAGE_WIDGETS[widget.type];
  const problemCount = problems.countUnder(path);
  const summary = widgetSummary(widget);

  return (
    <SortableItem id={widget.id} label={`${definition.label} widget`} canDrag={canDrag} className="rounded-md">
      {(grip) => (
        <Collapsible
          open={open}
          onOpenChange={setOpen}
          className={cn("rounded-md border bg-background", problemCount > 0 && "border-destructive/60")}
          data-testid={`widget-${widget.id}`}
        >
          <div className="flex items-center gap-1 py-1 pl-1 pr-1.5">
            {grip}
            <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="shrink-0 text-sm font-medium">{definition.label}</span>
              {summary && <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>}
              {problemCount > 0 && (
                <Badge variant="destructive" className="ml-auto shrink-0 px-1.5 py-0 text-[11px]">
                  {problemCount === 1 ? "1 problem" : `${problemCount} problems`}
                </Badge>
              )}
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  problemCount === 0 && "ml-auto",
                  open && "rotate-180"
                )}
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              aria-label={`Remove ${definition.label} widget`}
              data-testid={`button-remove-widget-${widget.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <CollapsibleContent className="border-t px-4 py-4">
            <WidgetConfigForm
              widget={widget}
              onChange={onChange}
              path={fieldPath(path, "config")}
              problems={problems}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </SortableItem>
  );
}
