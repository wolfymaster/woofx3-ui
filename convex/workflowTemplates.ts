import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    trigger: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("workflowTemplates").collect();
    if (args.trigger) {
      return all.filter((t) => t.trigger === args.trigger);
    }
    return all;
  },
});

export const get = query({
  args: { templateId: v.id("workflowTemplates") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.templateId);
  },
});

// Seed predefined Twitch event templates (run once via dashboard or script)
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("workflowTemplates").first();
    if (existing) return; // Already seeded

    const templates = [
      {
        name: "New Follower Welcome",
        description: "Send a chat message when someone follows the channel",
        trigger: "follow",
        workflowJson: {
          name: "New Follower Welcome",
          enabled: true,
          steps: [
            {
              id: "step-1",
              name: "Send Welcome Message",
              type: "command",
              parameters: {
                message: "Welcome {{username}} to the channel! 🎉",
              },
            },
          ],
          variables: {},
        },
      },
      {
        name: "Subscription Alert",
        description: "Celebrate when someone subscribes",
        trigger: "subscribe",
        workflowJson: {
          name: "Subscription Alert",
          enabled: true,
          steps: [
            {
              id: "step-1",
              name: "Send Sub Message",
              type: "command",
              parameters: {
                message:
                  "Thank you {{username}} for the {{tier}} sub! 🎊 You're awesome!",
              },
            },
          ],
          variables: {},
        },
      },
      {
        name: "Bits Cheer Alert",
        description: "Thank viewers who cheer with bits",
        trigger: "bits",
        workflowJson: {
          name: "Bits Cheer Alert",
          enabled: true,
          steps: [
            {
              id: "step-1",
              name: "Send Cheer Thanks",
              type: "command",
              parameters: {
                message:
                  "{{username}} just cheered {{amount}} bits! Thank you so much! 💎",
              },
            },
          ],
          variables: {},
        },
      },
      {
        name: "Raid Welcome",
        description: "Welcome raiders from another channel",
        trigger: "raid",
        workflowJson: {
          name: "Raid Welcome",
          enabled: true,
          steps: [
            {
              id: "step-1",
              name: "Welcome Raiders",
              type: "command",
              parameters: {
                message:
                  "🚨 RAID! Welcome {{raiderName}} and their {{viewerCount}} viewers! Everyone say hi!",
              },
            },
          ],
          variables: {},
        },
      },
      {
        name: "Gift Sub Alert",
        description: "Celebrate when someone gifts subscriptions",
        trigger: "gift",
        workflowJson: {
          name: "Gift Sub Alert",
          enabled: true,
          steps: [
            {
              id: "step-1",
              name: "Send Gift Sub Message",
              type: "command",
              parameters: {
                message:
                  "{{username}} just gifted {{count}} subs to the community! 🎁 What a legend!",
              },
            },
          ],
          variables: {},
        },
      },
    ];

    for (const template of templates) {
      await ctx.db.insert("workflowTemplates", template);
    }
  },
});
