import {
  Bell,
  Bug,
  CircleHelp,
  FolderOpen,
  GraduationCap,
  HardDrive,
  Key,
  Layers,
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  MessageSquarePlus,
  Palette,
  Puzzle,
  Radio,
  ScrollText,
  Server,
  Settings,
  Tally5,
  Timer,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

export interface NavSection extends NavItem {
  /** Sub-navigation rendered in the section sidebar. Absent for single-page sections. */
  children?: NavItem[];
}

export const STREAM_ITEMS: NavItem[] = [
  { id: "alerts", label: "Alerts", icon: Bell, href: "/stream/alerts" },
  { id: "commands", label: "Commands", icon: MessageSquare, href: "/stream/commands" },
  { id: "counters", label: "Counters", icon: Tally5, href: "/stream/counters" },
  { id: "scenes", label: "Scenes", icon: Layers, href: "/stream/scenes" },
  { id: "timers", label: "Timers", icon: Timer, href: "/stream/timers" },
  { id: "queues", label: "Queues", icon: ListOrdered, href: "/stream/queues" },
  { id: "assets", label: "Assets", icon: FolderOpen, href: "/stream/assets" },
  { id: "workflows", label: "Workflows", icon: Workflow, href: "/stream/workflows" },
];

export const HELP_ITEMS: NavItem[] = [
  { id: "learning", label: "Learning", icon: GraduationCap, href: "/help/learning" },
  { id: "debug", label: "Debug", icon: Bug, href: "/help/debug" },
  { id: "logs", label: "Logs", icon: ScrollText, href: "/help/logs" },
  { id: "feedback", label: "Submit Feedback", icon: MessageSquarePlus, href: "/help/feedback" },
];

export const ADMIN_ITEMS: NavItem[] = [
  { id: "engine", label: "Engine", icon: Server, href: "/admin/engine" },
  { id: "integrations", label: "Integrations", icon: Key, href: "/admin/integrations" },
  { id: "storage", label: "Storage", icon: HardDrive, href: "/admin/storage" },
  { id: "appearance", label: "Appearance", icon: Palette, href: "/admin/appearance" },
];

export const MAIN_NAV_SECTIONS: NavSection[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { id: "stream", label: "Stream", icon: Radio, href: STREAM_ITEMS[0].href, children: STREAM_ITEMS },
  { id: "modules", label: "Modules", icon: Puzzle, href: "/modules" },
  { id: "help", label: "Help", icon: CircleHelp, href: HELP_ITEMS[0].href, children: HELP_ITEMS },
];

/** Icon-only entries in the header's right-hand utility cluster. */
export const UTILITY_SECTIONS: NavSection[] = [
  { id: "team", label: "Team", icon: Users, href: "/team" },
  { id: "admin", label: "Admin", icon: Settings, href: ADMIN_ITEMS[0].href, children: ADMIN_ITEMS },
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
  return location === item.href || location.startsWith(`${item.href}/`);
}

export function findActiveSection(location: string): NavSection | null {
  const sections = [...MAIN_NAV_SECTIONS, ...UTILITY_SECTIONS];
  return sections.find((section) => isSectionActive(section, location)) ?? null;
}
