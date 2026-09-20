import {
  Activity,
  BellRing,
  Grid3x3,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Pin,
  Radio,
  Tv,
  Volume2,
  Workflow,
  Zap,
} from "lucide-react";
import { ActivityPanelWidget } from "@/components/dashboard/widgets/activity-panel";
import { AlertLogWidget } from "@/components/dashboard/widgets/alert-log";
import { AnnouncementWidget } from "@/components/dashboard/widgets/announcement";
import { LiveEventsWidget } from "@/components/dashboard/widgets/live-events";
import { MacroPadModule } from "@/components/dashboard/widgets/macro-pad";
import { NotesWidget } from "@/components/dashboard/widgets/notes";
import { PinnedWidget } from "@/components/dashboard/widgets/pinned";
import { ShoutoutWidget } from "@/components/dashboard/widgets/shoutout";
import { StreamPreviewWidget } from "@/components/dashboard/widgets/stream-preview";
import { StreamStatsWidget } from "@/components/dashboard/widgets/stream-stats";
import { StreamStatusWidget } from "@/components/dashboard/widgets/stream-status";
import { WorkflowRunsModule } from "@/components/dashboard/widgets/workflow-runs";
import type { DashboardWidgetCategory, DashboardWidgetDefinition } from "./types";

// Explicit list, not auto-discovered — see types.ts for why this only holds
// UI-native widgets. Each entry's `type` is the stable key persisted as
// DashboardPanelWidget.type (convex/schema.ts); renaming one orphans any
// panel zone already using it (falls back to DashboardZone's "Unknown widget
// type" branch, not a crash).
export const dashboardWidgets: DashboardWidgetDefinition[] = [
  {
    type: "stream-status",
    label: "Stream Status",
    description: "Live/offline state, viewer count, and uptime.",
    icon: Radio,
    category: "stream",
    component: StreamStatusWidget,
  },
  {
    type: "live-events",
    label: "Live Events",
    description: "Realtime follows, subs, cheers, and raids — straight from Twitch, no engine round-trip.",
    icon: Zap,
    category: "stream",
    component: LiveEventsWidget,
  },
  {
    type: "activity",
    label: "Activity",
    description: "Live events, pinned notes, and saved highlights in one tabbed card.",
    icon: MessagesSquare,
    category: "stream",
    component: ActivityPanelWidget,
  },
  {
    type: "stream-preview",
    label: "Stream Preview",
    description: "Thumbnail preview of your live stream — click to enlarge into a full player.",
    icon: Tv,
    category: "stream",
    component: StreamPreviewWidget,
  },
  {
    type: "announcement",
    label: "Announcement",
    description: "Send a coloured announcement to chat.",
    icon: Megaphone,
    category: "stream",
    component: AnnouncementWidget,
  },
  {
    type: "pinned",
    label: "Pinned",
    description: "Pin a message in chat, and keep past ones to pin again.",
    icon: Pin,
    category: "stream",
    component: PinnedWidget,
  },
  {
    type: "shoutout",
    label: "Shoutout",
    description: "Queue shoutouts for people in chat — sent one at a time, two minutes apart.",
    icon: Volume2,
    category: "stream",
    component: ShoutoutWidget,
  },
  {
    type: "workflow-runs",
    label: "Workflow Runs",
    description: "Recent and in-progress workflow executions.",
    icon: Workflow,
    category: "automation",
    component: WorkflowRunsModule,
  },
  {
    type: "alert-log",
    label: "Alert Log",
    description: "Alerts the engine sent, and the reason any of them never played.",
    icon: BellRing,
    category: "automation",
    component: AlertLogWidget,
  },
  {
    type: "stream-stats",
    label: "Stream Stats",
    description: "Viewers, uptime, category, and what's come in since the page loaded.",
    icon: Activity,
    category: "utility",
    component: StreamStatsWidget,
  },
  {
    type: "notes",
    label: "Notes",
    description: "A scratch pad for this stream — private to you, saved as you type.",
    icon: NotebookPen,
    category: "utility",
    component: NotesWidget,
  },
  {
    type: "macro-pad",
    label: "Macro Pad",
    description: "One-click buttons for chat commands, workflows, and HTTP requests.",
    icon: Grid3x3,
    category: "automation",
    component: MacroPadModule,
  },
];

export function getDashboardWidget(type: string): DashboardWidgetDefinition | undefined {
  return dashboardWidgets.find((widget) => widget.type === type);
}

export const dashboardWidgetCategoryLabels: Record<DashboardWidgetCategory, string> = {
  stream: "Stream",
  automation: "Automation",
  utility: "Utility",
};

export function dashboardWidgetsByCategory(): Array<{
  category: DashboardWidgetCategory;
  label: string;
  widgets: DashboardWidgetDefinition[];
}> {
  const categories: DashboardWidgetCategory[] = ["stream", "automation", "utility"];
  return categories.map((category) => ({
    category,
    label: dashboardWidgetCategoryLabels[category],
    widgets: dashboardWidgets.filter((widget) => widget.category === category),
  }));
}
