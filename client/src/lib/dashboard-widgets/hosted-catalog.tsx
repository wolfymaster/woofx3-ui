import { Clapperboard, ListChecks, Pin, Rocket, Volume2 } from "lucide-react";
import { GettingStartedChecklist, useGettingStarted } from "@/components/dashboard/getting-started-checklist";
import { StarterPacksNudge } from "@/components/dashboard/starter-packs-nudge";
import { GoLiveWidget } from "@/components/dashboard/widgets/go-live";
import { HostedMacroPadWidget } from "@/components/dashboard/widgets/hosted-macro-pad";
import { PinnedWidget } from "@/components/dashboard/widgets/pinned";
import { ShoutoutWidget } from "@/components/dashboard/widgets/shoutout";
import { StreamInfoWidget } from "@/components/dashboard/widgets/stream-info";
import { useInstance } from "@/hooks/use-instance";
import type { DashboardCatalog, RailPinnedItem } from "./catalog";
import {
  activityWidget,
  adBreaksWidget,
  announcementWidget,
  eventsWidget,
  macroPadWidget,
  moderationWidget,
  notesWidget,
  queueWidget,
  recentStreamsWidget,
  streamPreviewWidget,
  streamStatsWidget,
  streamStatusWidget,
  timerWidget,
  workflowRunsWidget,
} from "./gateway-widgets";
import type { DashboardWidgetDefinition } from "./types";

// The hosted app's dashboard: every widget. Those below reach data only
// Convex keeps (the go-live checklist, pin history, the shoutout queue,
// stream info presets, macros' remote trigger URLs), so only the hosted app
// may load this module.

const goLiveWidget: DashboardWidgetDefinition = {
  type: "go-live",
  label: "Go Live Checklist",
  description: "Pre-flight checks before you go live: engine, Twitch, overlays, OBS, stream info and workflows.",
  icon: Rocket,
  category: "stream",
  component: GoLiveWidget,
};

const streamInfoWidget: DashboardWidgetDefinition = {
  type: "stream-info",
  label: "Stream Info",
  description: "Edit your title, category and tags, switch between saved presets, and drop stream markers.",
  icon: Clapperboard,
  category: "stream",
  component: StreamInfoWidget,
};

const pinnedWidget: DashboardWidgetDefinition = {
  type: "pinned",
  label: "Pinned",
  description: "Pin a message in chat, and keep past ones to pin again.",
  icon: Pin,
  category: "stream",
  component: PinnedWidget,
};

const shoutoutWidget: DashboardWidgetDefinition = {
  type: "shoutout",
  label: "Shoutout",
  description: "Queue shoutouts for people in chat — sent one at a time, two minutes apart.",
  icon: Volume2,
  category: "stream",
  component: ShoutoutWidget,
};

const hostedMacroPadWidget: DashboardWidgetDefinition = { ...macroPadWidget, component: HostedMacroPadWidget };

/** The getting started checklist, pinned first on the rail while it has anything left to do. */
function useGettingStartedRailItem(): RailPinnedItem | null {
  const { instance } = useInstance();
  const gettingStarted = useGettingStarted(instance?._id ?? null);
  if (!gettingStarted) {
    return null;
  }
  return {
    id: "getting-started",
    label: `Getting started · ${gettingStarted.progress.done} of ${gettingStarted.progress.total} done`,
    icon: ListChecks,
    dot: gettingStarted.hasProblem ? "problem" : "attention",
    content: <GettingStartedChecklist gettingStarted={gettingStarted} />,
  };
}

export const hostedDashboardCatalog: DashboardCatalog = {
  widgets: [
    streamStatusWidget,
    goLiveWidget,
    eventsWidget,
    activityWidget,
    streamInfoWidget,
    streamPreviewWidget,
    announcementWidget,
    pinnedWidget,
    adBreaksWidget,
    shoutoutWidget,
    moderationWidget,
    queueWidget,
    timerWidget,
    workflowRunsWidget,
    streamStatsWidget,
    recentStreamsWidget,
    notesWidget,
    hostedMacroPadWidget,
  ],
  usePinnedRailItem: useGettingStartedRailItem,
  Notice: StarterPacksNudge,
};
