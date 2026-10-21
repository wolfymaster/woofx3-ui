import { Boxes } from "lucide-react";
import { useMemo } from "react";
import type { NavItem } from "@/components/layout/nav-config";
import { useResourceKinds } from "@/engine/hooks/use-module-resources";
import { useInstance } from "@/hooks/use-instance";
import { dynamicLucideIcon } from "@/lib/dynamic-lucide-icon";
import { isBuiltInKind, pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";

/**
 * A menu entry for every resource kind an installed module declares, other than
 * the built-in ones, which the menu lists already. Empty until the
 * kinds have loaded.
 */
export function useResourceKindNavItems(): NavItem[] {
  const { instance } = useInstance();
  const kinds = useResourceKinds(instance?._id ?? null);

  return useMemo(
    () =>
      (kinds ?? [])
        .filter((kind) => !isBuiltInKind(kind.moduleName, kind.kind))
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
