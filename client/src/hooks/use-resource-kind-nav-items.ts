import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Boxes } from "lucide-react";
import { useMemo } from "react";
import type { NavItem } from "@/components/layout/nav-config";
import { useInstance } from "@/hooks/use-instance";
import { dynamicLucideIcon } from "@/lib/dynamic-lucide-icon";
import { hasFirstPartyPage, pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";

/**
 * A menu entry for every resource kind an installed module declares, other than
 * those with a first-party page, which the menu lists already. Empty until the
 * kinds have loaded.
 */
export function useResourceKindNavItems(): NavItem[] {
  const { instance } = useInstance();
  const kinds = useQuery(api.resourceKinds.listForInstance, instance ? { instanceId: instance._id } : "skip");

  return useMemo(
    () =>
      (kinds ?? [])
        .filter((kind) => !hasFirstPartyPage(kind.moduleName, kind.kind))
        .map(
          (kind): NavItem => ({
            id: `resource-kind:${kind.moduleName}:${kind.kind}`,
            label: pluralKindName(kind.name || kind.kind),
            icon: kind.icon ? dynamicLucideIcon(kind.icon) : Boxes,
            href: resourceKindPath(kind.moduleName, kind.kind),
          })
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
    [kinds]
  );
}
