import { MARKETPLACE_PATH } from "@/lib/marketplace-route";

// One explanation per term, so a term reads the same in every HelpTip and on
// the Learning page. Written for a streamer, not a developer: say what the
// thing does for their stream, not how it is built.

export type GlossaryCategory = "automation" | "overlays" | "setup" | "dashboard";

export interface GlossaryEntry {
  term: string;
  category: GlossaryCategory;
  definition: string;
  /** In-app page where the term can be seen in use. */
  href?: string;
}

const ENTRIES = {
  workflow: {
    term: "Workflow",
    category: "automation",
    definition:
      "An automation: when something happens on your stream, woofx3 runs a list of steps. For example, when someone follows, play an alert and thank them in chat.",
    href: "/stream/workflows",
  },
  trigger: {
    term: "Trigger",
    category: "automation",
    definition: "Your rule for when a workflow starts, such as on a follow, a raid, a cheer or a chat command.",
  },
  action: {
    term: "Step",
    category: "automation",
    definition:
      "One thing a workflow does, such as send a chat message, play an alert or switch a scene. A workflow runs its steps in order.",
  },
  condition: {
    term: "Condition",
    category: "automation",
    definition:
      "A rule that must hold for a workflow to run, such as only for cheers of 100 bits or more. If it doesn't hold, the workflow skips that event.",
  },
  command: {
    term: "Chat command",
    category: "automation",
    definition:
      "A word viewers type in chat, starting with !, that makes woofx3 respond. For example, !discord replies with your Discord invite.",
    href: "/stream/commands",
  },
  module: {
    term: "Module",
    category: "setup",
    definition:
      "Gives woofx3 new triggers, steps and widgets. Install modules from the marketplace; platforms like Twitch are modules too.",
    href: MARKETPLACE_PATH,
  },
  platform: {
    term: "Platform",
    category: "setup",
    definition:
      "An outside service woofx3 connects to, such as Twitch or Spotify. Each platform is a module that you install and then connect to your account.",
    href: MARKETPLACE_PATH,
  },
  scene: {
    term: "Scene",
    category: "overlays",
    definition:
      "A layout of widgets drawn on top of your stream, like alerts, a chat box or a goal bar. Each scene has its own overlay link.",
    href: "/stream/scenes",
  },
  browserSource: {
    term: "Browser source",
    category: "overlays",
    definition:
      "A source in your streaming software that shows a web page on your stream. Paste a scene's overlay link into one to put it on screen.",
  },
  overlay: {
    term: "Overlay",
    category: "overlays",
    definition:
      "Graphics drawn over your stream, such as alerts and widgets. woofx3 draws them from a scene, and your streaming software shows them through a browser source.",
  },
  panel: {
    term: "Panel",
    category: "dashboard",
    definition:
      "One page of your dashboard. Each panel has its own layout and widgets, so you can keep one for going live and another for moderating.",
    href: "/",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof ENTRIES;

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = ENTRIES;

export const GLOSSARY_CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  setup: "Setup",
  automation: "Automation",
  overlays: "Scenes and overlays",
  dashboard: "Dashboard",
};
