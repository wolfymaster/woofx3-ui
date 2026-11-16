import type { PlanTier } from "@convex/lib/organization";

export interface PlanDetails {
  tagline: string;
  audience: string;
  /** Plain-language benefits, in the order they are listed when choosing a plan. */
  highlights: string[];
}

/** What each paid plan includes; keep the wording in step with the marketing pricing page (woofx3-marketing `client/src/content/pricing.ts`). */
export const PLAN_DETAILS: Record<PlanTier, PlanDetails> = {
  starter: {
    tagline: "We run it for you, so you can bring your team.",
    audience:
      "Best for streamers with mods or helpers who want one shared dashboard and a home page for their channel.",
    highlights: [
      "Everything in Desktop, run for you, so there's nothing to keep running on your PC",
      "Up to 5 people on your team, each with their own sign-in",
      "A shared dashboard, so your mods see what you see",
      "Your own public page where viewers can find you",
      "50 GB for add-ons and 100 GB for images, sounds and clips",
      "30 days of stream stats",
    ],
  },
  pro: {
    tagline: "For full-time streamers who run their channel like a business.",
    audience: "Best for full-time streamers and larger teams who want every premium add-on and room to grow.",
    highlights: [
      "Everything in Starter",
      "As many team members as you need",
      "Every woofx3 premium add-on included",
      "Your page on your own web address, like yourname.com",
      "100 GB for add-ons and 500 GB for images, sounds and clips",
      "90 days of stream stats, so you can spot trends over a season",
      "Business tools for running your channel as a business",
    ],
  },
};
