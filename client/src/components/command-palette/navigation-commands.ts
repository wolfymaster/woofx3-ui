import { FilePlus2, FolderTree, MessageSquarePlus, PackageOpen, Plus, UserPlus } from "lucide-react";
import {
  flattenNavItems,
  type InstanceHosting,
  MAIN_NAV_SECTIONS,
  type NavItem,
  navItemsFor,
  STREAM_ITEMS,
  sectionsFor,
  UTILITY_SECTIONS,
} from "@/components/layout/nav-config";
import { COMMAND_GROUP_NEW_ROUTE, COMMAND_GROUPS_PATH, COMMAND_NEW_ROUTE } from "@/lib/command-editor-route";
import type { PaletteCommand } from "./types";

export const GO_TO_GROUP = "Go to";
export const CREATE_GROUP = "Create";

/**
 * Other words for each menu entry, keyed by nav id. Only words someone might reach for
 * that the label does not already hold.
 */
const PAGE_KEYWORDS: Record<string, readonly string[]> = {
  dashboard: ["home", "widgets", "panels"],
  "go-live": ["checklist", "start stream", "preflight"],
  alerts: ["notifications", "follows", "subs", "raids", "cheers", "test event", "overlay"],
  commands: ["chat commands", "!"],
  counters: ["count", "deaths"],
  scenes: ["overlays", "browser source", "obs"],
  timers: ["countdown", "clock"],
  queues: ["line", "viewers queue"],
  recaps: ["history", "past streams", "sessions", "summary"],
  supporters: ["leaderboard", "top cheerers", "gifters", "bits"],
  assets: ["files", "media", "images", "sounds", "uploads", "resources"],
  workflows: ["automation", "rules", "builder"],
  "starter-packs": ["templates", "presets", "get started"],
  modules: ["plugins", "extensions", "marketplace", "install"],
  learning: ["docs", "help", "tutorials"],
  logs: ["events", "debug", "errors"],
  feedback: ["bug", "report", "suggest", "idea", "vote", "feature request"],
  team: ["members", "users", "sharing", "people"],
  engine: ["instance", "connection", "version", "settings"],
  integrations: ["twitch", "connect", "oauth", "accounts"],
  storage: ["r2", "files", "settings"],
  backup: ["export", "import", "restore"],
  appearance: ["theme", "colors", "dark mode", "palette"],
};

function pageCommand(item: NavItem, section?: string): PaletteCommand {
  return {
    id: `page:${item.id}`,
    title: item.label,
    kind: "page",
    group: GO_TO_GROUP,
    subtitle: section,
    keywords: PAGE_KEYWORDS[item.id],
    icon: item.icon,
    action: { type: "navigate", href: item.href },
  };
}

/**
 * Every destination in the menu for an instance hosted this way, in menu order, plus the
 * pages it only reaches by a link. Instance settings are left out for a non-admin.
 */
export function navigationCommands(hosting: InstanceHosting, isAdmin: boolean): PaletteCommand[] {
  const sections = sectionsFor([...MAIN_NAV_SECTIONS, ...UTILITY_SECTIONS], isAdmin);
  const pages: PaletteCommand[] = [];
  for (const section of sections) {
    if (!section.children) {
      pages.push(pageCommand(section));
      continue;
    }
    for (const child of flattenNavItems(navItemsFor(section.children, hosting))) {
      pages.push(pageCommand(child, section.label));
    }
  }

  const streamLabel = MAIN_NAV_SECTIONS.find((section) => section.children === STREAM_ITEMS)?.label;
  pages.push({
    id: "page:command-groups",
    title: "Command groups",
    kind: "page",
    group: GO_TO_GROUP,
    subtitle: streamLabel,
    keywords: ["permissions", "roles", "access"],
    icon: FolderTree,
    action: { type: "navigate", href: COMMAND_GROUPS_PATH },
  });

  const create: PaletteCommand[] = [
    {
      id: "create:workflow",
      title: "New workflow",
      kind: "action",
      group: CREATE_GROUP,
      keywords: ["create", "add", "automation"],
      icon: Plus,
      action: { type: "navigate", href: "/stream/workflows/new" },
    },
    {
      id: "create:command",
      title: "New chat command",
      kind: "action",
      group: CREATE_GROUP,
      keywords: ["create", "add", "!"],
      icon: MessageSquarePlus,
      action: { type: "navigate", href: COMMAND_NEW_ROUTE },
    },
    {
      id: "create:command-group",
      title: "New command group",
      kind: "action",
      group: CREATE_GROUP,
      keywords: ["create", "add", "permissions"],
      icon: FolderTree,
      action: { type: "navigate", href: COMMAND_GROUP_NEW_ROUTE },
    },
    {
      id: "create:module",
      title: "Install module from file",
      kind: "action",
      group: CREATE_GROUP,
      keywords: ["upload", "zip", "plugin", "add"],
      icon: PackageOpen,
      action: { type: "navigate", href: "/modules/install" },
    },
    {
      id: "create:asset",
      title: "Upload asset",
      kind: "action",
      group: CREATE_GROUP,
      keywords: ["file", "image", "sound", "media", "add"],
      icon: FilePlus2,
      action: { type: "navigate", href: STREAM_ITEMS.find((item) => item.id === "assets")?.href ?? "/stream/assets" },
    },
    {
      id: "create:invite",
      title: "Invite teammate",
      kind: "action",
      group: CREATE_GROUP,
      keywords: ["team", "member", "share", "add user"],
      icon: UserPlus,
      action: { type: "navigate", href: "/team/invite" },
    },
  ];

  return [...pages, ...create];
}
