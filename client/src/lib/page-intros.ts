import type { GlossaryKey } from "@/lib/glossary";

export interface PageIntroContent {
  title: string;
  body: string;
  term: GlossaryKey;
}

// Keys must match pageIntroIdValidator in convex/schema.ts.
export const PAGE_INTROS = {
  workflows: {
    title: "Make your stream react on its own",
    body: "A workflow waits for an event, like a follow or a raid, then runs its steps: play an alert, post in chat, switch a scene. Pick a trigger, then add steps.",
    term: "workflow",
  },
  scenes: {
    title: "Put widgets on your stream",
    body: "A scene is a layout of widgets, such as alerts, goals and chat, drawn over your stream. Lay one out here, then add its overlay link to your streaming software.",
    term: "scene",
  },
  modules: {
    title: "Add what your stream needs",
    body: "Modules add triggers, steps and widgets to woofx3. Platforms like Twitch are modules too.",
    term: "module",
  },
} as const satisfies Record<string, PageIntroContent>;

export type PageIntroId = keyof typeof PAGE_INTROS;

export function isPageIntroId(value: string): value is PageIntroId {
  return Object.hasOwn(PAGE_INTROS, value);
}
