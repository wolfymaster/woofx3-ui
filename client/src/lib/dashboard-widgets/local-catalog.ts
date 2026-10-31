import { type DashboardCatalog, noPinnedRailItem } from "./catalog";
import {
  activityWidget,
  adBreaksWidget,
  announcementWidget,
  eventsWidget,
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

/**
 * The desktop app's local mode: the widgets a lone engine can serve. It
 * leaves out the go-live checklist, stream info, pinned messages, shoutouts
 * and the macro pad, whose data only Convex keeps, and has no getting started
 * checklist or starter packs, which belong to an account's setup.
 */
export const localDashboardCatalog: DashboardCatalog = {
  widgets: [
    streamStatusWidget,
    eventsWidget,
    activityWidget,
    streamPreviewWidget,
    announcementWidget,
    adBreaksWidget,
    moderationWidget,
    queueWidget,
    timerWidget,
    workflowRunsWidget,
    streamStatsWidget,
    recentStreamsWidget,
    notesWidget,
  ],
  usePinnedRailItem: noPinnedRailItem,
  Notice: null,
};
