/**
 * What a streamer says they want woofx3 to do at setup, and what each answer
 * turns into: starter packs to install.
 * Shared by Convex, which applies the choices, and the wizard, which offers
 * them, so the two cannot drift. Pure, so it can be tested without a runtime.
 */

import { STARTER_MODULES } from "@shared/starter-packs";

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
    description: "Change your title and category and moderate chat from the dashboard.",
    needs: [STARTER_MODULES.twitch],
    packIds: [],
  },
];

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
