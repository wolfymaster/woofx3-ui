import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface WidgetInspectorTabsProps {
  /** The widget's own fields, drawn from its schema. */
  settings: ReactNode;
  transitions: ReactNode;
  effects: ReactNode;
  /** Changes when the selection does, so a newly selected widget opens on Settings. */
  idPrefix: string;
}

/**
 * The three things a selected widget can be edited by, one at a time.
 *
 * Settings come from the widget's schema, while transitions and effects are
 * behaviors that target it. They used to share one scrolling column, which made
 * a widget with a short form look like it had no behaviors at all. Tabs give
 * each its own pane without making the right rail wider.
 */
export function WidgetInspectorTabs({ settings, transitions, effects, idPrefix }: WidgetInspectorTabsProps) {
  return (
    <Tabs key={idPrefix} defaultValue="settings" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="grid h-9 w-full shrink-0 grid-cols-3 rounded-none border-b bg-transparent p-0">
        <TabsTrigger
          value="settings"
          className="rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          data-testid="widget-inspector-tab-settings"
        >
          Settings
        </TabsTrigger>
        <TabsTrigger
          value="transitions"
          className="rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          data-testid="widget-inspector-tab-transitions"
        >
          Transitions
        </TabsTrigger>
        <TabsTrigger
          value="effects"
          className="rounded-none border-b-2 border-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          data-testid="widget-inspector-tab-effects"
        >
          Effects
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="settings"
        className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="widget-inspector-panel-settings"
      >
        {settings}
      </TabsContent>
      <TabsContent
        value="transitions"
        className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="widget-inspector-panel-transitions"
      >
        {transitions}
      </TabsContent>
      <TabsContent
        value="effects"
        className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="widget-inspector-panel-effects"
      >
        {effects}
      </TabsContent>
    </Tabs>
  );
}
