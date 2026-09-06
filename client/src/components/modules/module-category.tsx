import { Bell, MessageSquare, Music, Puzzle, Video, Zap } from "lucide-react";
import type { MarketplaceListItem } from "@/hooks/use-marketplace-catalog";

const categoryIcons: Record<string, React.ReactNode> = {
  Chat: <MessageSquare className="h-3.5 w-3.5" />,
  Alerts: <Bell className="h-3.5 w-3.5" />,
  Media: <Video className="h-3.5 w-3.5" />,
  Audio: <Music className="h-3.5 w-3.5" />,
  Automation: <Zap className="h-3.5 w-3.5" />,
  Integrations: <Puzzle className="h-3.5 w-3.5" />,
  Effects: <Puzzle className="h-3.5 w-3.5" />,
  Utilities: <Puzzle className="h-3.5 w-3.5" />,
};

// moduleRepository.category is optional at the schema level (older/manually
// created installed modules may have none), so every helper here falls back
// to "Utilities" rather than assuming a string.
const DEFAULT_CATEGORY = "Utilities";

export function getCategoryIcon(category: string | undefined) {
  return categoryIcons[category || DEFAULT_CATEGORY] || <Puzzle className="h-3.5 w-3.5" />;
}

// Categories are free-text from the marketplace (no fixed enum), so colors are
// derived deterministically from the string rather than a hardcoded hue map —
// the same category always renders the same color across sessions.
function categoryHue(category: string | undefined): number {
  const value = category || DEFAULT_CATEGORY;
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function getCategoryColor(category: string | undefined): string {
  const hue = categoryHue(category);
  return `oklch(0.55 0.18 ${hue})`;
}

// Repeating diagonal banding, standing in for the screenshot/cover art the
// marketplace API doesn't provide.
export function getCategoryBannerStyle(category: string | undefined): React.CSSProperties {
  const hue = categoryHue(category);
  const light = `oklch(0.28 0.09 ${hue})`;
  const dark = `oklch(0.22 0.07 ${hue})`;
  return {
    backgroundImage: `repeating-linear-gradient(135deg, ${light} 0px, ${light} 14px, ${dark} 14px, ${dark} 28px)`,
  };
}

export interface CategoryCount {
  category: string;
  count: number;
}

export function getCategoryCounts(modules: MarketplaceListItem[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const m of modules) {
    if (!m.category) {
      continue;
    }
    counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
