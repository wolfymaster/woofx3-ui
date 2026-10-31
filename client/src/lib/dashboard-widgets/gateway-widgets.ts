import {
  Activity,
  AlarmClock,
  Grid3x3,
  ListOrdered,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Radio,
  Shield,
  Timer,
  Tv,
  Workflow,
  Zap,
} from "lucide-react";
import { ActivityPanelWidget } from "@/components/dashboard/widgets/activity-panel";
import { AdBreaksWidget } from "@/components/dashboard/widgets/ad-breaks";
import { AnnouncementWidget } from "@/components/dashboard/widgets/announcement";
import { EventsWidget } from "@/components/dashboard/widgets/events";
import { MacroPadWidget } from "@/components/dashboard/widgets/macro-pad";
import { ModerationWidget } from "@/components/dashboard/widgets/moderation";
import { NotesWidget } from "@/components/dashboard/widgets/notes";
import { QueueWidget } from "@/components/dashboard/widgets/queue";
import { StreamPreviewWidget } from "@/components/dashboard/widgets/stream-preview";
import { StreamStatsWidget } from "@/components/dashboard/widgets/stream-stats";
import { StreamStatusWidget } from "@/components/dashboard/widgets/stream-status";
import { TimerWidget } from "@/components/dashboard/widgets/timer";
import { WorkflowRunsModule } from "@/components/dashboard/widgets/workflow-runs";
import type { DashboardWidgetDefinition } from "./types";

// The dashboard widgets that reach the engine only through its gateway, and
// that every gateway serves, so every mode's catalog can hold them. Explicit,
// not auto-discovered: see types.ts for why only UI-native widgets are here.
// Each `type` is the stable key a saved layout stores (DashboardPanelWidget.type);
// renaming one leaves a layout already using it with a widget no catalog
// has, which the dashboard shows as unavailable rather than crashing.

export const streamStatusWidget: DashboardWidgetDefinition = {
  type: "stream-status",
  label: "Stream Status",
  description: "Live/offline state, viewer count, and uptime.",
  icon: Radio,
  category: "stream",
  component: StreamStatusWidget,
};

export const eventsWidget: DashboardWidgetDefinition = {
  type: "events",
  label: "Events",
  description: "Everything that happened on stream, with the alerts it played, their status and replay.",
  icon: Zap,
  category: "stream",
  component: EventsWidget,
};

export const activityWidget: DashboardWidgetDefinition = {
  type: "activity",
  label: "Activity",
  description: "The events feed and saved highlights in one tabbed card.",
  icon: MessagesSquare,
  category: "stream",
  component: ActivityPanelWidget,
};

export const streamPreviewWidget: DashboardWidgetDefinition = {
  type: "stream-preview",
  label: "Stream Preview",
  description: "Thumbnail preview of your live stream — click to enlarge into a full player.",
  icon: Tv,
  category: "stream",
  component: StreamPreviewWidget,
};

export const announcementWidget: DashboardWidgetDefinition = {
  type: "announcement",
  label: "Announcement",
  description: "Send a coloured announcement to chat.",
  icon: Megaphone,
  category: "stream",
  component: AnnouncementWidget,
};

export const adBreaksWidget: DashboardWidgetDefinition = {
  type: "ad-breaks",
  label: "Ad Breaks",
  description: "Countdown to the next ad, preroll-free time, and a snooze button while you are live.",
  icon: AlarmClock,
  category: "stream",
  component: AdBreaksWidget,
};

export const moderationWidget: DashboardWidgetDefinition = {
  type: "moderation",
  label: "Moderation",
  description: "Block a phrase, time out or ban someone, and lock chat down without leaving the dashboard.",
  icon: Shield,
  category: "stream",
  component: ModerationWidget,
};

export const queueWidget: DashboardWidgetDefinition = {
  type: "queue",
  label: "Queue",
  description: "A queue's line, with add and remove — the same actions chat and workflows use.",
  icon: ListOrdered,
  category: "stream",
  component: QueueWidget,
};

export const timerWidget: DashboardWidgetDefinition = {
  type: "timer",
  label: "Timer",
  description: "A timer's countdown, with start, pause and add time: the same actions chat and workflows use.",
  icon: Timer,
  category: "stream",
  component: TimerWidget,
};

export const workflowRunsWidget: DashboardWidgetDefinition = {
  type: "workflow-runs",
  label: "Workflow Runs",
  description: "Recent and in-progress workflow executions.",
  icon: Workflow,
  category: "automation",
  component: WorkflowRunsModule,
};

export const streamStatsWidget: DashboardWidgetDefinition = {
  type: "stream-stats",
  label: "Stream Stats",
  description: "Viewers, uptime, category, and what's come in since the page loaded.",
  icon: Activity,
  category: "utility",
  component: StreamStatsWidget,
};

export const notesWidget: DashboardWidgetDefinition = {
  type: "notes",
  label: "Notes",
  description: "A scratch pad for this stream — private to you, saved as you type.",
  icon: NotebookPen,
  category: "utility",
  component: NotesWidget,
};

/** The pad alone; the hosted catalog's adds its macros' remote trigger URLs. */
export const macroPadWidget: DashboardWidgetDefinition = {
  type: "macro-pad",
  label: "Macro Pad",
  description: "One-click buttons for chat commands, workflows, and HTTP requests.",
  icon: Grid3x3,
  category: "automation",
  component: MacroPadWidget,
};
