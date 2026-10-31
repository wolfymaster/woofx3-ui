import {
  PAGE_LAYOUTS,
  PAGE_WIDGET_TYPES,
  PAGE_WIDGETS,
  type PageLayout,
  type PageSection,
  type PageWidgetType,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import { Plus, Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldProblems } from "@/components/user-page/field-problems";
import { SortableItem, SortableList } from "@/components/user-page/sortable";
import { WidgetCard } from "@/components/user-page/widget-card";
import { fieldPath, itemPath, type ProblemIndex } from "@/lib/page-problems";
import {
  isVisibilityOption,
  type PageEditorAction,
  REGION_LABELS,
  VISIBILITY_OPTIONS,
  visibilityFromOption,
  visibilityOption,
} from "@/lib/user-page-editor";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  section: PageSection;
  layout: PageLayout;
  /** The section's problem path: `sections[i]`, by its place in the whole page. */
  path: string;
  problems: ProblemIndex;
  canDrag: boolean;
  /** Whether the page has room for another widget anywhere. */
  pageHasRoom: boolean;
  /** The widget most recently added, which opens with its settings showing. */
  addedWidgetId: string | null;
  onAddWidget: (sectionId: string, widgetType: PageWidgetType) => void;
  dispatch: Dispatch<PageEditorAction>;
}

export function SectionCard({
  section,
  layout,
  path,
  problems,
  canDrag,
  pageHasRoom,
  addedWidgetId,
  onAddWidget,
  dispatch,
}: SectionCardProps) {
  const regions = PAGE_LAYOUTS[layout].regions;
  const name = section.title ?? "Untitled section";
  const widgetsPath = fieldPath(path, "widgets");
  const canAddWidget = pageHasRoom && section.widgets.length < USER_PAGE_LIMITS.widgetsPerSection;
  const ownProblems = [
    ...problems.at(path),
    ...problems.at(fieldPath(path, "id")),
    ...problems.at(fieldPath(path, "region")),
    ...problems.at(widgetsPath),
  ];

  return (
    <SortableItem id={section.id} label={`section ${name}`} canDrag={canDrag} className="rounded-lg">
      {(grip) => (
        <section
          className={cn(
            "rounded-lg border bg-card shadow-sm",
            problems.countUnder(path) > 0 && "border-destructive/50"
          )}
          aria-label={name}
          data-testid={`section-${section.id}`}
        >
          <header className="flex flex-wrap items-center gap-2 border-b px-2 py-2">
            {grip}
            <Input
              value={section.title ?? ""}
              placeholder="Untitled section"
              aria-label="Section title"
              aria-invalid={problems.at(fieldPath(path, "title")).length > 0}
              className="h-8 min-w-[10rem] flex-1 border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-input focus-visible:border-input"
              onChange={(event) =>
                dispatch({ type: "updateSection", sectionId: section.id, changes: { title: event.target.value } })
              }
              data-testid={`input-section-title-${section.id}`}
            />
            {regions.length > 1 && (
              <Select
                value={section.region}
                onValueChange={(value) => {
                  const region = regions.find((candidate) => candidate === value);
                  if (region) {
                    dispatch({ type: "updateSection", sectionId: section.id, changes: { region } });
                  }
                }}
              >
                <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Where on the page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((region) => (
                    <SelectItem key={region} value={region}>
                      {REGION_LABELS[region]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={visibilityOption(section.visibility)}
              onValueChange={(value) => {
                if (isVisibilityOption(value)) {
                  dispatch({
                    type: "updateSection",
                    sectionId: section.id,
                    changes: { visibility: visibilityFromOption(value) },
                  });
                }
              }}
            >
              <SelectTrigger
                className="h-8 w-[200px] text-xs"
                aria-label="Who can see it"
                data-testid={`select-visibility-${section.id}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => dispatch({ type: "removeSection", sectionId: section.id })}
              aria-label={`Remove section ${name}`}
              data-testid={`button-remove-section-${section.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </header>

          <div className="space-y-2 p-3">
            <FieldProblems messages={[...problems.at(fieldPath(path, "title")), ...ownProblems]} />
            {section.widgets.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">Nothing in this section yet. Add a widget.</p>
            ) : (
              <SortableList
                ids={section.widgets.map((widget) => widget.id)}
                onMove={(widgetId, overWidgetId) =>
                  dispatch({ type: "moveWidget", sectionId: section.id, widgetId, overWidgetId })
                }
                className="space-y-2"
              >
                {section.widgets.map((widget, index) => (
                  <WidgetCard
                    key={widget.id}
                    widget={widget}
                    path={itemPath(widgetsPath, index)}
                    problems={problems}
                    canDrag={section.widgets.length > 1}
                    startOpen={widget.id === addedWidgetId}
                    onChange={(next) => dispatch({ type: "replaceWidget", sectionId: section.id, widget: next })}
                    onRemove={() => dispatch({ type: "removeWidget", sectionId: section.id, widgetId: widget.id })}
                  />
                ))}
              </SortableList>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={!canAddWidget}
                  data-testid={`button-add-widget-${section.id}`}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add widget
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                {PAGE_WIDGET_TYPES.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    className="flex flex-col items-start gap-0.5"
                    onSelect={() => onAddWidget(section.id, type)}
                    data-testid={`menu-add-widget-${type}`}
                  >
                    <span className="text-sm font-medium">{PAGE_WIDGETS[type].label}</span>
                    <span className="text-xs text-muted-foreground">{PAGE_WIDGETS[type].description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </section>
      )}
    </SortableItem>
  );
}
