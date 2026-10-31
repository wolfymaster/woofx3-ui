import { ListChecks, Pin } from "lucide-react";
import { GettingStartedChecklist, useGettingStarted } from "@/components/dashboard/getting-started-checklist";
import { StarterPacksNudge } from "@/components/dashboard/starter-packs-nudge";
import { HostedMacroPadWidget } from "@/components/dashboard/widgets/hosted-macro-pad";
import { PinnedWidget } from "@/components/dashboard/widgets/pinned";
import { useInstance } from "@/hooks/use-instance";
import type { DashboardCatalog, RailPinnedItem } from "./catalog";
import {
  activityWidget,
  adBreaksWidget,
  announcementWidget,
  eventsWidget,
  goLiveWidget,
  macroPadWidget,
  moderationWidget,
  notesWidget,
  queueWidget,
  recentStreamsWidget,
  shoutoutWidget,
  streamInfoWidget,
  streamPreviewWidget,
  streamStatsWidget,
  streamStatusWidget,
  timerWidget,
  workflowRunsWidget,
} from "./gateway-widgets";
import type { DashboardWidgetDefinition } from "./types";

// The hosted app's dashboard: every widget. Those below reach data only
// Convex keeps (pin history, macros' remote trigger URLs), so only the hosted
// app may load this module.

const pinnedWidget: DashboardWidgetDefinition = {
  type: "pinned",
  label: "Pinned",
  description: "Pin a message in chat, and keep past ones to pin again.",
  icon: Pin,
  category: "stream",
  component: PinnedWidget,
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
