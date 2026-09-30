/**
 * What a streamer says they want woofx3 to do at setup, and what each answer
 * turns into: starter packs to install and widgets for their first dashboard.
 * Shared by Convex, which applies the choices, and the wizard, which offers
 * them, so the two cannot drift. Pure, so it can be tested without a runtime.
 */

import { STARTER_MODULES } from "./starterPacks";

export interface SetupInterest {
  id: string;
  label: string;
  description: string;
  /** Marketplace module ids the interest needs; it is offered only when all of them are chosen. */
  needs: readonly string[];
  /** Starter packs installed for it, with their default wording. */
  packIds: readonly string[];
}

export const SETUP_INTERESTS: readonly SetupInterest[] = [
  {
    id: "thank-followers-raiders",
    label: "Thank followers and raiders",
    description: "Welcome raids and thank new followers in chat.",
    needs: [STARTER_MODULES.twitch],
    packIds: ["follower-thanks", "raid-welcome"],
  },
  {
    id: "celebrate-subs-cheers",
    label: "Celebrate subs and cheers",
    description: "Thank subscribers, gifters and cheerers in chat.",
    needs: [STARTER_MODULES.twitch],
    packIds: ["sub-hype", "cheer-thanks"],
  },
  {
    id: "chat-commands",
    label: "Chat commands",
    description: "Handy commands like !socials and !lurk.",
    needs: [STARTER_MODULES.twitch],
    packIds: ["handy-commands"],
  },
  {
    id: "switch-obs-scenes",
    label: "Switch OBS scenes",
    description: "Change scenes from chat and workflows.",
    needs: [STARTER_MODULES.obs],
    packIds: ["brb-scene"],
  },
  {
    id: "manage-stream",
    label: "Manage my stream from here",
    description: "Change your title and category, moderate chat and go live from the dashboard.",
    needs: [STARTER_MODULES.twitch],
    packIds: [],
  },
];

export type SetupInterestId = (typeof SETUP_INTERESTS)[number]["id"];

/** The interests whose modules are all among `chosenModuleIds`, in list order. */
export function availableInterests(chosenModuleIds: readonly string[]): SetupInterest[] {
  const chosen = new Set(chosenModuleIds);
  return SETUP_INTERESTS.filter((interest) => interest.needs.every((id) => chosen.has(id)));
}

/**
 * The starter packs to install for the chosen interests, each once, in list
 * order. Interests whose modules were not chosen, and unknown ids, add nothing.
 */
export function starterPacksForInterests(interestIds: readonly string[], chosenModuleIds: readonly string[]): string[] {
  const wanted = new Set(interestIds);
  const packIds: string[] = [];
  for (const interest of availableInterests(chosenModuleIds)) {
    if (!wanted.has(interest.id)) {
      continue;
    }
    for (const packId of interest.packIds) {
      if (!packIds.includes(packId)) {
        packIds.push(packId);
      }
    }
  }
  return packIds;
}

export interface PresetWidget {
  zoneId: string;
  slotId: string;
  type: string;
}

/**
 * The layout of the first dashboard panel: a narrow dock, a wide activity
 * column and a column of stream controls. Must be an id in
 * client/src/lib/dashboard-layouts.ts, whose zone ids are `${row}-${column}`.
 */
export const PRESET_LAYOUT_ID = "dock-activity-controls";

const DOCK_ZONE = "0-0";
const ACTIVITY_ZONE = "0-1";
const CONTROLS_ZONE = "0-2";

// A zone stacks its widgets vertically; past this many each gets too short to use.
const MAX_WIDGETS_PER_ZONE = 3;

/**
 * The first dashboard panel's widgets for the chosen interests. Every zone
 * gets at least one widget, so skipping the question still gives a usable
 * dashboard rather than empty zones. Widget types must be canvas widgets in
 * client/src/lib/dashboard-widgets/registry.ts.
 */
export function buildDashboardPreset(interestIds: readonly string[]): PresetWidget[] {
  const wants = (id: SetupInterestId) => interestIds.includes(id);

  const dock = wants("chat-commands") ? ["macro-pad"] : ["stream-status"];

  const activity = ["live-events"];
  if (wants("thank-followers-raiders")) {
    activity.push("activity");
  }
  if (wants("celebrate-subs-cheers")) {
    activity.push("alert-log");
  }

  const controls: string[] = [];
  if (!dock.includes("stream-status")) {
    controls.push("stream-status");
  }
  controls.push("stream-info");
  if (wants("manage-stream")) {
    controls.push("go-live", "moderation");
  }
  if (wants("switch-obs-scenes")) {
    controls.push("stream-preview");
  }

  const zones: [string, string[]][] = [
    [DOCK_ZONE, dock],
    [ACTIVITY_ZONE, activity],
    [CONTROLS_ZONE, controls],
  ];
  return zones.flatMap(([zoneId, types]) =>
    types.slice(0, MAX_WIDGETS_PER_ZONE).map((type) => ({ zoneId, slotId: `${zoneId}:${type}`, type }))
  );
}
