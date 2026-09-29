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
    definition: "The event that starts a workflow, such as a follow, a raid, a cheer or a chat command.",
  },
  action: {
    term: "Action",
    category: "automation",
    definition:
      "One thing a workflow does, such as send a chat message, play an alert or switch an OBS scene. A workflow runs its actions in order.",
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
      "An add-on that gives woofx3 new triggers, actions and widgets. Install modules from the marketplace; platforms like Twitch and OBS are modules too.",
    href: "/modules",
  },
  platform: {
    term: "Platform",
    category: "setup",
    definition:
      "An outside service woofx3 connects to, such as Twitch, OBS or Spotify. Each platform is a module that you install and then connect to your account.",
    href: "/modules",
  },
  scene: {
    term: "Scene",
    category: "overlays",
    definition:
      "A layout of widgets drawn on top of your stream, like alerts, a chat box or a goal bar. Each scene has its own browser source URL.",
    href: "/stream/scenes",
  },
  browserSource: {
    term: "Browser source",
    category: "overlays",
    definition:
      "An OBS source that shows a web page on your stream. Paste a scene's browser source URL into one to put that scene's overlay on screen.",
  },
  overlay: {
    term: "Overlay",
    category: "overlays",
    definition:
      "Graphics drawn over your stream, such as alerts and widgets. woofx3 draws them from a scene, and OBS shows them through a browser source.",
  },
  engine: {
    term: "Engine",
    category: "setup",
    definition:
      "The woofx3 server that runs your workflows, commands and overlays. It keeps running when this site is closed, so automations work while you stream.",
  },
  instance: {
    term: "Instance",
    category: "setup",
    definition:
      "Your engine as this site knows it: its address, connected platforms and settings. Everyone on your team works on the same instance.",
  },
  panel: {
    term: "Panel",
    category: "dashboard",
    definition:
      "One page of your dashboard. Each panel has its own layout and widgets, so you can keep one for going live and another for moderating.",
    href: "/",
  },
  zone: {
    term: "Zone",
    category: "dashboard",
    definition:
      "An area of a panel's layout that holds widgets. A zone can stack several widgets and you can resize them within it.",
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
