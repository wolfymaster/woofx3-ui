import type { ReactNode } from "react";

export interface WidgetDefinition {
  type: string;
  name: string;
  description: string;
  icon: string;
  category: "stream" | "chat" | "alerts" | "automation" | "system";
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
}

export interface WidgetInstance {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  widgets: WidgetInstance[];
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    type: "stream-status",
    name: "Stream Status",
    description: "Shows live/offline status, viewer count, and uptime",
    icon: "Radio",
    category: "stream",
    defaultSize: { width: 4, height: 2 },
    minSize: { width: 2, height: 1 },
  },
  {
    type: "recent-events",
    name: "Recent Events",
    description: "Latest Twitch events like follows, subs, cheers",
    icon: "Activity",
    category: "stream",
    defaultSize: { width: 4, height: 4 },
    minSize: { width: 2, height: 2 },
  },
  {
    type: "quick-actions",
    name: "Quick Actions",
    description: "Common action buttons for stream management",
    icon: "Zap",
    category: "automation",
    defaultSize: { width: 4, height: 2 },
    minSize: { width: 2, height: 1 },
  },
  {
    type: "chat-preview",
    name: "Chat Preview",
    description: "Recent chat messages from Twitch",
    icon: "MessageSquare",
    category: "chat",
    defaultSize: { width: 4, height: 4 },
    minSize: { width: 2, height: 2 },
  },
  {
    type: "module-status",
    name: "Module Status",
    description: "Installed modules and their health status",
    icon: "Puzzle",
    category: "system",
    defaultSize: { width: 4, height: 3 },
    minSize: { width: 2, height: 2 },
  },
  {
    type: "workflow-activity",
    name: "Workflow Activity",
    description: "Recent workflow executions",
    icon: "Workflow",
    category: "automation",
    defaultSize: { width: 4, height: 3 },
    minSize: { width: 2, height: 2 },
  },
  {
    type: "alert-queue",
    name: "Alert Queue",
    description: "Current alert queue depth and controls",
    icon: "Bell",
    category: "alerts",
    defaultSize: { width: 4, height: 2 },
    minSize: { width: 2, height: 1 },
  },
];

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type);
}

export function getDefaultLayout(): WidgetInstance[] {
  return [
    {
      id: "default-stream-status",
      type: "stream-status",
      position: { x: 0, y: 0 },
      size: { width: 4, height: 2 },
    },
    {
      id: "default-recent-events",
      type: "recent-events",
      position: { x: 4, y: 0 },
      size: { width: 4, height: 4 },
    },
    {
      id: "default-quick-actions",
      type: "quick-actions",
      position: { x: 8, y: 0 },
      size: { width: 4, height: 2 },
    },
  ];
}
