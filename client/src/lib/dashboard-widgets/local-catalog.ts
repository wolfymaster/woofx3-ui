import { type DashboardCatalog, noPinnedRailItem } from "./catalog";
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

/**
 * The desktop app's local mode: the widgets a lone engine can serve. It
 * leaves out pinned messages, whose data only Convex keeps, and has no getting
 * started checklist or starter packs, which belong to an account's setup. Its
 * macro pad has no remote trigger URLs, which Convex serves.
 */
export const localDashboardCatalog: DashboardCatalog = {
  widgets: [
    streamStatusWidget,
    goLiveWidget,
    eventsWidget,
    activityWidget,
    streamInfoWidget,
    streamPreviewWidget,
    announcementWidget,
    adBreaksWidget,
    shoutoutWidget,
    moderationWidget,
    queueWidget,
    timerWidget,
    workflowRunsWidget,
    streamStatsWidget,
    recentStreamsWidget,
    notesWidget,
    macroPadWidget,
  ],
  usePinnedRailItem: noPinnedRailItem,
  Notice: null,
};
