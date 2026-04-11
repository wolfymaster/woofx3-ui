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
    ],
    sidebar: {
      "/ui/": [
        {
          text: "Product UI",
          collapsed: false,
          items: [
            { text: "Shell & routing", link: "/ui/overview" },
            { text: "Dashboard", link: "/ui/dashboard" },
            { text: "Modules", link: "/ui/modules" },
            { text: "Workflows", link: "/ui/workflows" },
            { text: "Assets", link: "/ui/assets" },
            { text: "Scenes & overlays", link: "/ui/scenes" },
            { text: "Settings & team", link: "/ui/settings-team" },
            { text: "Auth & onboarding", link: "/ui/auth-onboarding" },
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
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/wolfymaster/woofx3-ui" }],
  },
});
