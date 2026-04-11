import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CircleHelp } from "lucide-react";

const iconMap = LucideIcons as unknown as Record<string, LucideIcon | undefined>;

export function resolveLucideIcon(name: string): LucideIcon {
  const Icon = iconMap[name];
  if (typeof Icon === "function") {
    return Icon;
  }
  return CircleHelp;
}
