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
  MessageSquare,
  MessageSquarePlus,
  Palette,
  Radio,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  ToggleRight,
  Users,
} from "lucide-react";
import { ALERT_LIBRARY_EDITOR_BASE } from "@/lib/alert-editor-route";
import { ALERT_GROUPS_PATH } from "@/lib/alert-groups-route";
import { ALERT_RUN_BASE } from "@/lib/alert-run-route";
import { MODERATION_PATH } from "@/lib/chat-moderation-form";
import { FEEDBACK_PATH } from "@/lib/feedback";
import { MARKETPLACE_PATH, MODULES_PATH } from "@/lib/marketplace-route";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";
import { STREAM_RECAPS_PATH } from "@/lib/stream-recap-route";

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
   * always show beneath it, so the menu keeps one shape on every page.
   */
  children?: NavItem[];
  /** Sits at the foot of a section's sidebar, above the collapse control, instead of in the list. */
  docked?: boolean;
  /** Marked only on its own path, for an index entry whose siblings live below it. */
  exact?: boolean;
  /**
   * Heading of the run of entries this one belongs to. Entries of a group sit next to each
   * other; the sidebar prints the heading where the group starts.
   */
  group?: string;
  /** A short label at the row's right edge, such as where a module came from. */
  badge?: string;
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

/** Group headings of the Stream sidebar, in the order the groups appear. */
export const STREAM_GROUPS = {
  react: "React",
  build: "Build",
  data: "Data",
  modules: "Modules",
  community: "Community",
} as const;

export const STREAM_ITEMS: NavItem[] = [
  {
    id: "alerts",
    label: "Alerts",
    icon: STREAM_OBJECT_ICONS.alerts,
    href: "/stream/alerts",
    owns: [ALERT_LIBRARY_EDITOR_BASE, ALERT_RUN_BASE],
    group: STREAM_GROUPS.react,
  },
  { id: "commands", label: "Commands", icon: MessageSquare, href: "/stream/commands", group: STREAM_GROUPS.react },
  {
    id: "schedules",
    label: "Schedules",
    icon: STREAM_OBJECT_ICONS.schedules,
    href: "/stream/schedules",
    group: STREAM_GROUPS.react,
  },
  {
    id: "scenes",
    label: "Scenes",
    icon: STREAM_OBJECT_ICONS.scenes,
    href: "/stream/scenes",
    group: STREAM_GROUPS.build,
  },
  { id: "assets", label: "Media", icon: FolderOpen, href: "/stream/assets", group: STREAM_GROUPS.build },
  { id: "forms", label: "Forms", icon: STREAM_OBJECT_ICONS.forms, href: "/stream/forms", group: STREAM_GROUPS.build },
  {
    id: "counters",
    label: "Counters",
    icon: STREAM_OBJECT_ICONS.counters,
    href: "/stream/counters",
    group: STREAM_GROUPS.data,
  },
  {
    id: "timers",
    label: "Timers",
    icon: STREAM_OBJECT_ICONS.timers,
    href: "/stream/timers",
    group: STREAM_GROUPS.data,
  },
  {
    id: "queues",
    label: "Queues",
    icon: STREAM_OBJECT_ICONS.queues,
    href: "/stream/queues",
    group: STREAM_GROUPS.data,
  },
  {
    id: "databases",
    label: "Databases",
    icon: STREAM_OBJECT_ICONS.databases,
    href: "/stream/databases",
    group: STREAM_GROUPS.data,
  },
  {
    id: "modules-settings",
    label: "Settings",
    icon: SlidersHorizontal,
    href: MODULES_PATH,
    exact: true,
    group: STREAM_GROUPS.modules,
  },
  {
    id: "supporters",
    label: "Supporters",
    icon: HandHeart,
    href: "/stream/supporters",
    group: STREAM_GROUPS.community,
  },
  { id: "recaps", label: "Recaps", icon: History, href: STREAM_RECAPS_PATH, group: STREAM_GROUPS.community },
  { id: "moderation", label: "Moderation", icon: ShieldCheck, href: MODERATION_PATH, group: STREAM_GROUPS.community },
  { id: "user-page", label: "Your page", icon: Globe, href: USER_PAGE_PATH, group: STREAM_GROUPS.community },
];

/** Offered only on an engine that has alert groups (see `useAlertGroupsNavItems`); it sits right after Alerts. */
export const ALERT_GROUPS_ITEM: NavItem = {
  id: "alert-groups",
  label: "Alert Groups",
  icon: ToggleRight,
  href: ALERT_GROUPS_PATH,
  group: STREAM_GROUPS.react,
};

export const HELP_ITEMS: NavItem[] = [
  { id: "learning", label: "Learning", icon: GraduationCap, href: "/help/learning" },
  { id: "logs", label: "Logs", icon: ScrollText, href: "/help/logs" },
  { id: "feedback", label: "Feedback", icon: MessageSquarePlus, href: FEEDBACK_PATH },
];

export const ADMIN_ITEMS: NavItem[] = [
  { id: "engine", label: "woofx3", icon: Server, href: "/admin/engine" },
  { id: "integrations", label: "Integrations", icon: Key, href: "/admin/integrations" },
  { id: "storage", label: "Storage", icon: HardDrive, href: "/admin/storage", selfHostedOnly: true },
  { id: "backup", label: "Backup", icon: ArchiveRestore, href: "/admin/backup" },
  { id: "appearance", label: "Appearance", icon: Palette, href: "/admin/appearance" },
];

export const MAIN_NAV_SECTIONS: NavSection[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/" },
  // Lands on Alerts, like the /stream redirect in App.tsx.
  { id: "stream", label: "Stream", icon: Radio, href: "/stream/alerts", children: STREAM_ITEMS },
  { id: "marketplace", label: "Marketplace", icon: Store, href: MARKETPLACE_PATH },
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
  // `owns` counts here as well as on a sidebar entry: a section stays marked
  // on paths that sit beside its root rather than below it.
  return [root, ...(section.owns ?? [])].some((path) => location === path || location.startsWith(`${path}/`));
}

export function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.exact) {
    return location === item.href;
  }
  return [item.href, ...(item.owns ?? [])].some((path) => location === path || location.startsWith(`${path}/`));
}

/** `items` with `extra` right after Alerts, unchanged when the menu has no Alerts entry. */
export function withAlertGroupsItems(items: NavItem[], extra: NavItem[]): NavItem[] {
  const alerts = items.findIndex((item) => item.id === "alerts");
  if (extra.length === 0 || alerts === -1) {
    return items;
  }
  return [...items.slice(0, alerts + 1), ...extra, ...items.slice(alerts + 1)];
}

/**
 * `items` with `extra` added at the end of `group`, taking on its heading. `items` comes
 * back unchanged when `extra` is empty or the menu has no such group (Help, Admin).
 */
function withGroupItems(items: NavItem[], group: string, extra: NavItem[]): NavItem[] {
  const last = items.map((item) => item.group).lastIndexOf(group);
  if (extra.length === 0 || last === -1) {
    return items;
  }
  const grouped = extra.map((item) => ({ ...item, group }));
  return [...items.slice(0, last + 1), ...grouped, ...items.slice(last + 1)];
}

/**
 * `items` with `extra` at the end of the Data group: the resource kinds installed
 * modules declare, beside the built-in counters, timers, queues and databases.
 */
export function withResourceKindItems(items: NavItem[], extra: NavItem[]): NavItem[] {
  return withGroupItems(items, STREAM_GROUPS.data, extra);
}

/** `items` with `extra` after Settings in the Modules group: one entry per installed module. */
export function withInstalledModuleItems(items: NavItem[], extra: NavItem[]): NavItem[] {
  return withGroupItems(items, STREAM_GROUPS.modules, extra);
}

/** Entries the engine and the installed modules add to a menu, merged by `withDynamicItems`. */
export interface DynamicNavItems {
  alertGroups: NavItem[];
  resourceKinds: NavItem[];
  installedModules: NavItem[];
}

/** `items` with every dynamic entry in its place: what a shell shows for a menu section. */
export function withDynamicItems(items: NavItem[], dynamic: DynamicNavItems): NavItem[] {
  return withInstalledModuleItems(
    withResourceKindItems(withAlertGroupsItems(items, dynamic.alertGroups), dynamic.resourceKinds),
    dynamic.installedModules
  );
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
