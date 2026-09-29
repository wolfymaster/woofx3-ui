import type { GlossaryKey } from "@/lib/glossary";

export interface PageIntroContent {
  title: string;
  body: string;
  tryLabel: string;
  term: GlossaryKey;
}

// Keys must match pageIntroIdValidator in convex/schema.ts.
export const PAGE_INTROS = {
  workflows: {
    title: "Make your stream react on its own",
    body: "A workflow waits for something to happen, like a follow or a raid, then runs its steps: play an alert, post in chat, switch a scene. Start from a trigger and add what should happen.",
    tryLabel: "Create a workflow",
    term: "workflow",
  },
  scenes: {
    title: "Put widgets on your stream",
    body: "A scene is a layout of widgets, such as alerts, goals and chat, drawn over your stream. Lay one out here, then add its browser source URL to OBS.",
    tryLabel: "Create a scene",
    term: "scene",
  },
  modules: {
    title: "Add what your stream needs",
    body: "Modules add triggers, actions and widgets to woofx3. Platforms like Twitch and OBS are modules too, so connect one here to use it in workflows.",
    tryLabel: "Browse the marketplace",
    term: "module",
  },
} as const satisfies Record<string, PageIntroContent>;

export type PageIntroId = keyof typeof PAGE_INTROS;
