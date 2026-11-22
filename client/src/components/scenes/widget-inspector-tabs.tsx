import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface WidgetInspectorTabsProps {
  /** The widget's own fields, drawn from its schema; null when it has none, which hides the Settings tab. */
  settings: ReactNode;
  transitions: ReactNode;
  effects: ReactNode;
  /** Changes when the selection does, so a newly selected widget opens on Settings. */
  idPrefix: string;
}

const TABS = [
  { value: "settings", label: "Settings" },
  { value: "transitions", label: "Transitions" },
  { value: "effects", label: "Effects" },
] as const;

const TRIGGER_CLASS =
  "rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none";
const CONTENT_CLASS = "mt-0 min-h-0 flex-1 overflow-y-auto p-4";

/**
 * The three things a selected widget can be edited by, one at a time.
 *
 * Settings come from the widget's schema, while transitions and effects are
 * behaviors that target it. Each pane scrolls on its own, so a short settings
 * form never hides the behaviors available in the narrow right rail.
 */
// stylegate:ignore TS-NAM-001 reason="Repo convention names component files in kebab-case, as every neighbouring editor component does."
export function WidgetInspectorTabs({ settings, transitions, effects, idPrefix }: WidgetInspectorTabsProps) {
  const panes: Record<(typeof TABS)[number]["value"], ReactNode> = { settings, transitions, effects };
  const tabs = settings === null ? TABS.filter((tab) => tab.value !== "settings") : TABS;
  return (
    <Tabs key={idPrefix} defaultValue={tabs[0].value} className="flex min-h-0 flex-1 flex-col">
      <TabsList
        className={cn(
          "grid h-9 w-full shrink-0 rounded-none border-b bg-transparent p-0",
          tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"
        )}
      >
        {tabs.map(({ value, label }) => (
          <TabsTrigger
            key={value}
            value={value}
            className={TRIGGER_CLASS}
            data-testid={`widget-inspector-tab-${value}`}
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map(({ value }) => (
        <TabsContent
          key={value}
          value={value}
          className={CONTENT_CLASS}
          data-testid={`widget-inspector-panel-${value}`}
        >
          {panes[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
