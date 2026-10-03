import { defineConfig } from "vitepress";

export default defineConfig({
  title: "WoofX3 UI",
  description: "Control plane UI — architecture notes, patterns, and design decisions",
  srcExclude: ["**/superpowers/**"],
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "UI areas", link: "/ui/overview" },
      { text: "Patterns", link: "/patterns/" },
      { text: "Operations", link: "/ops/deploy" },
    ],
    sidebar: {
      "/ui/": [
        {
          text: "Product UI",
          collapsed: false,
          items: [
            { text: "Shell & routing", link: "/ui/overview" },
            { text: "Dashboard", link: "/ui/dashboard" },
            { text: "Quick actions", link: "/ui/quick-actions" },
            { text: "Stream recaps", link: "/ui/stream-recaps" },
            { text: "Feedback", link: "/ui/feedback" },
            { text: "Chat commands", link: "/ui/commands" },
            { text: "Modules", link: "/ui/modules" },
            { text: "Workflows", link: "/ui/workflows" },
            { text: "Assets", link: "/ui/assets" },
            { text: "Scenes & overlays", link: "/ui/scenes" },
            { text: "Admin & team", link: "/ui/admin-team" },
            { text: "Importing from Firebot and Streamer.bot", link: "/ui/setup-imports" },
            { text: "Auth & onboarding", link: "/ui/auth-onboarding" },
            { text: "Companion app", link: "/ui/companion" },
            { text: "Convex & HTTP", link: "/ui/convex-surface" },
          ],
        },
      ],
      "/patterns/": [
        {
          text: "UI codebase",
          collapsed: false,
          items: [
            { text: "Overview", link: "/patterns/" },
            { text: "configSchema contract", link: "/patterns/config-schema" },
            { text: "In-app help", link: "/patterns/in-app-help" },
          ],
        },
      ],
      "/ops/": [
        {
          text: "Operations",
          collapsed: false,
          items: [
            { text: "Deploying to production", link: "/ops/deploy" },
            { text: "Pull request previews", link: "/ops/previews" },
            { text: "Companion releases", link: "/ops/companion-releases" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/wolfymaster/woofx3-ui" }],
  },
  vite: {
    css: {
      // The docs site uses no Tailwind. Without this, Vite walks up and picks up
      // the app's postcss.config.js, which needs tailwindcss from the root
      // node_modules -- so the docs build would depend on a root install.
      postcss: { plugins: [] },
    },
  },
});
