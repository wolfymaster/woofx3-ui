import {
  ArchiveRestore,
  Bell,
  CircleHelp,
  FolderOpen,
  GraduationCap,
  HandHeart,
  HardDrive,
  History,
  Key,
  Layers,
  LayoutDashboard,
  ListChecks,
  ListOrdered,
  MessageSquare,
  MessageSquarePlus,
  PackagePlus,
  Palette,
  Puzzle,
  Radio,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Tally5,
  Timer,
  Users,
  Workflow,
} from "lucide-react";
import { ALERT_EDITOR_BASE } from "@/lib/alert-editor-route";
import { ALERT_RUN_BASE } from "@/lib/alert-run-route";
import { FEEDBACK_PATH } from "@/lib/feedback";
import { STREAM_RECAPS_PATH } from "@/lib/stream-recap-route";

export const STARTER_PACKS_PATH = "/stream/starter-packs";

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
}

/** How the selected instance's engine is run; absent until an instance is known. */
export type InstanceHosting = "managed" | "external" | undefined;

/** The entries of a menu that apply to an instance hosted this way. */
export function navItemsFor(items: NavItem[], hosting: InstanceHosting): NavItem[] {
  if (hosting !== "managed") {
    return items;
  }
  return items.filter((item) => !item.selfHostedOnly);
}

export interface NavSection extends NavItem {
  /** Sub-navigation rendered in the section sidebar. Absent for single-page sections. */
  children?: NavItem[];
  /** Instance settings, shown only to the instance's owners and admins. */
  adminOnly?: boolean;
}

/** The sections a user with this standing on the current instance may open. */
export function sectionsFor(sections: NavSection[], isAdmin: boolean): NavSection[] {
  return isAdmin ? sections : sections.filter((section) => !section.adminOnly);
}

export const STREAM_ITEMS: NavItem[] = [
  { id: "go-live", label: "Go live", icon: Rocket, href: "/stream/go-live" },
  { id: "alerts", label: "Alerts", icon: Bell, href: "/stream/alerts", owns: [ALERT_EDITOR_BASE, ALERT_RUN_BASE] },
  { id: "commands", label: "Commands", icon: MessageSquare, href: "/stream/commands" },
  { id: "counters", label: "Counters", icon: Tally5, href: "/stream/counters" },
  { id: "scenes", label: "Scenes", icon: Layers, href: "/stream/scenes" },
  { id: "timers", label: "Timers", icon: Timer, href: "/stream/timers" },
  { id: "queues", label: "Queues", icon: ListOrdered, href: "/stream/queues" },
  { id: "recaps", label: "Recaps", icon: History, href: STREAM_RECAPS_PATH },
  { id: "supporters", label: "Supporters", icon: HandHeart, href: "/stream/supporters" },
  { id: "assets", label: "Assets", icon: FolderOpen, href: "/stream/assets" },
  { id: "workflows", label: "Workflows", icon: Workflow, href: "/stream/workflows" },
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
  { id: "modules", label: "Modules", icon: Puzzle, href: "/modules" },
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
  return location === root || location.startsWith(`${root}/`);
}

export function isNavItemActive(item: NavItem, location: string): boolean {
  return [item.href, ...(item.owns ?? [])].some((path) => location === path || location.startsWith(`${path}/`));
}

export function findActiveSection(location: string): NavSection | null {
  const sections = [...MAIN_NAV_SECTIONS, ...UTILITY_SECTIONS];
  return sections.find((section) => isSectionActive(section, location)) ?? null;
}
