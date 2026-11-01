import {
  ArchiveRestore,
  CircleHelp,
  FolderOpen,
  Globe,
  GraduationCap,
  HandHeart,
  HardDrive,
  History,
  Key,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  PackagePlus,
  Palette,
  Radio,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Store,
  Users,
  Workflow,
} from "lucide-react";
import { ALERT_LIBRARY_EDITOR_BASE } from "@/lib/alert-editor-route";
import { ALERT_RUN_BASE } from "@/lib/alert-run-route";
import { FEEDBACK_PATH } from "@/lib/feedback";
import { MARKETPLACE_PATH } from "@/lib/marketplace-route";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";
import { STREAM_RECAPS_PATH } from "@/lib/stream-recap-route";

export const STARTER_PACKS_PATH = "/stream/starter-packs";
export const USER_PAGE_PATH = "/stream/page";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  /**
   * Paths that belong to this entry but hang beside it rather than below: Alerts keeps
   * its editors and its runs outside `/stream/alerts`, because everything below that is
   * read as a menu path. Listed so the entry stays marked while one of them is open.
   */
  owns?: string[];
  /**
   * Configures something woofx3 decides for a managed engine, so the entry is left out
   * of the menu while the selected instance is managed.
   */
  selfHostedOnly?: boolean;
  /**
   * Entries nested under this one. A section's make up its sidebar; a sidebar entry's
   * open beneath it while it or one of them is the page on show.
   */
  children?: NavItem[];
}

/** How the selected instance's engine is run; absent until an instance is known. */
export type InstanceHosting = "managed" | "external" | undefined;

/** The entries of a menu that apply to an instance hosted this way. */
export function navItemsFor(items: NavItem[], hosting: InstanceHosting): NavItem[] {
  if (hosting !== "managed") {
    return items;
  }
  return items
    .filter((item) => !item.selfHostedOnly)
    .map((item) => (item.children ? { ...item, children: navItemsFor(item.children, hosting) } : item));
}

/** Every entry in `items`, each followed by the entries nested under it. */
export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flattenNavItems(item.children ?? [])]);
}

export interface NavSection extends NavItem {
  /** Instance settings, shown only to the instance's owners and admins. */
  adminOnly?: boolean;
}

/** The sections a user with this standing on the current instance may open. */
export function sectionsFor(sections: NavSection[], isAdmin: boolean): NavSection[] {
  return isAdmin ? sections : sections.filter((section) => !section.adminOnly);
}

export const STREAM_ITEMS: NavItem[] = [
  { id: "go-live", label: "Go live", icon: Rocket, href: "/stream/go-live" },
  {
    id: "alerts",
    label: "Alerts",
    icon: STREAM_OBJECT_ICONS.alerts,
    href: "/stream/alerts",
    owns: [ALERT_LIBRARY_EDITOR_BASE, ALERT_RUN_BASE],
    children: [
      { id: "counters", label: "Counters", icon: STREAM_OBJECT_ICONS.counters, href: "/stream/counters" },
      { id: "timers", label: "Timers", icon: STREAM_OBJECT_ICONS.timers, href: "/stream/timers" },
      { id: "queues", label: "Queues", icon: STREAM_OBJECT_ICONS.queues, href: "/stream/queues" },
      { id: "schedules", label: "Schedules", icon: STREAM_OBJECT_ICONS.schedules, href: "/stream/schedules" },
      { id: "forms", label: "Forms", icon: STREAM_OBJECT_ICONS.forms, href: "/stream/forms" },
      { id: "workflows", label: "Workflows", icon: Workflow, href: "/stream/workflows" },
    ],
  },
  { id: "commands", label: "Commands", icon: MessageSquare, href: "/stream/commands" },
  { id: "scenes", label: "Scenes", icon: STREAM_OBJECT_ICONS.scenes, href: "/stream/scenes" },
  { id: "recaps", label: "Recaps", icon: History, href: STREAM_RECAPS_PATH },
  { id: "supporters", label: "Supporters", icon: HandHeart, href: "/stream/supporters" },
  { id: "user-page", label: "Your page", icon: Globe, href: USER_PAGE_PATH },
  { id: "assets", label: "Media", icon: FolderOpen, href: "/stream/assets" },
  { id: "starter-packs", label: "Starter Packs", icon: PackagePlus, href: STARTER_PACKS_PATH },
];

export const HELP_ITEMS: NavItem[] = [
  { id: "learning", label: "Learning", icon: GraduationCap, href: "/help/learning" },
  { id: "setup", label: "Setup", icon: ListChecks, href: "/setup" },
  { id: "logs", label: "Logs", icon: ScrollText, href: "/help/logs" },
  { id: "feedback", label: "Feedback", icon: MessageSquarePlus, href: FEEDBACK_PATH },
];

export const ADMIN_ITEMS: NavItem[] = [
  { id: "engine", label: "Engine", icon: Server, href: "/admin/engine" },
  { id: "integrations", label: "Integrations", icon: Key, href: "/admin/integrations" },
  { id: "storage", label: "Storage", icon: HardDrive, href: "/admin/storage", selfHostedOnly: true },
  { id: "backup", label: "Backup", icon: ArchiveRestore, href: "/admin/backup" },
  { id: "appearance", label: "Appearance", icon: Palette, href: "/admin/appearance" },
];

export const MAIN_NAV_SECTIONS: NavSection[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/" },
  // Lands on Alerts, like the /stream redirect in App.tsx, rather than on the
  // first entry: Go live leads the list for visibility, not as the section's home.
  { id: "stream", label: "Stream", icon: Radio, href: "/stream/alerts", children: STREAM_ITEMS },
  // The storefront is /marketplace; /modules is still the install surface and
  // is reached from a listing, so the section owns both paths.
  { id: "marketplace", label: "Marketplace", icon: Store, href: MARKETPLACE_PATH, owns: ["/modules"] },
  { id: "help", label: "Help", icon: CircleHelp, href: HELP_ITEMS[0].href, children: HELP_ITEMS },
];

/** Icon-only entries in the header's right-hand utility cluster. */
export const UTILITY_SECTIONS: NavSection[] = [
  { id: "team", label: "Team", icon: Users, href: "/team" },
  { id: "admin", label: "Admin", icon: Settings, href: ADMIN_ITEMS[0].href, children: ADMIN_ITEMS, adminOnly: true },
];

/** Root path a section owns — everything under it belongs to that section. */
function sectionRoot(section: NavSection): string {
  return section.children ? `/${section.id}` : section.href;
}

export function isSectionActive(section: NavSection, location: string): boolean {
  const root = sectionRoot(section);
  if (root === "/") {
    return location === "/";
  }
  // `owns` counts here as well as on a sidebar entry: Marketplace owns
  // /modules, which is where a listing's install flow lives, and the section
  // should stay marked while the streamer is in it.
  return [root, ...(section.owns ?? [])].some((path) => location === path || location.startsWith(`${path}/`));
}

export function isNavItemActive(item: NavItem, location: string): boolean {
  return [item.href, ...(item.owns ?? [])].some((path) => location === path || location.startsWith(`${path}/`));
}

/**
 * `items` with `extra` nested under Alerts, ahead of Workflows: the resource kinds
 * installed modules declare, beside the built-in counters, timers, queues, schedules and forms.
 * `items` comes back unchanged when it has no Alerts entry.
 */
export function withAlertsChildren(items: NavItem[], extra: NavItem[]): NavItem[] {
  if (extra.length === 0) {
    return items;
  }
  return items.map((item) => {
    if (item.id !== "alerts") {
      return item;
    }
    const children = item.children ?? [];
    const workflows = children.findIndex((child) => child.id === "workflows");
    const at = workflows === -1 ? children.length : workflows;
    return { ...item, children: [...children.slice(0, at), ...extra, ...children.slice(at)] };
  });
}

/** Whether an entry's nested entries show: while it, or one of them, is the page on show. */
export function isNavGroupOpen(item: NavItem, location: string): boolean {
  if (!item.children) {
    return false;
  }
  return isNavItemActive(item, location) || item.children.some((child) => isNavItemActive(child, location));
}

export function findActiveSection(location: string): NavSection | null {
  const sections = [...MAIN_NAV_SECTIONS, ...UTILITY_SECTIONS];
  return sections.find((section) => isSectionActive(section, location)) ?? null;
}

/**
 * The entries of `items` whose page `has` reports, keeping an entry whose own
 * page is missing only while one nested under it remains (it then leads to
 * that one). For a build that serves a subset of the app's pages.
 */
export function navItemsServed(items: NavItem[], has: (href: string) => boolean): NavItem[] {
  return items.flatMap((item): NavItem[] => {
    const children = item.children ? navItemsServed(item.children, has) : undefined;
    if (has(item.href)) {
      return [children ? { ...item, children } : item];
    }
    if (children && children.length > 0) {
      return [{ ...item, href: children[0].href, children }];
    }
    return [];
  });
}
