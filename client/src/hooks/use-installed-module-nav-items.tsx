import { useMemo } from "react";
import type { NavItem } from "@/components/layout/nav-config";
import { getCategoryColor } from "@/components/modules/module-category";
import { useInstalledModules } from "@/engine/hooks/use-modules";
import type { InstalledModule, ModuleProvenance } from "@/engine/types";
import { installedModulePath } from "@/lib/marketplace-route";
import { bareModuleKey } from "@/lib/module-key";
import { cn } from "@/lib/utils";

const PROVENANCE_LABEL: { readonly [P in ModuleProvenance]: string } = {
  builtIn: "Built in",
  marketplace: "Marketplace",
  uploaded: "Uploaded",
};

/** The module's initial on its category's color, standing in for an icon. */
function moduleTile(module: InstalledModule): NavItem["icon"] {
  const color = getCategoryColor(module.category);
  const initial = module.name.charAt(0).toUpperCase();
  return function ModuleTile({ className }: { className?: string }) {
    return (
      <span
        className={cn(className, "flex items-center justify-center rounded-md text-[11px] font-bold text-white")}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {initial}
      </span>
    );
  };
}

/** A sidebar entry for every module installed on the engine, in the order the engine lists them. */
export function useInstalledModuleNavItems(): NavItem[] {
  const modules = useInstalledModules();

  return useMemo(
    () =>
      (modules ?? [])
        .filter((module) => module.status === "installed")
        .map(
          (module): NavItem => ({
            id: `module:${module.id}`,
            label: module.name,
            icon: moduleTile(module),
            href: installedModulePath(bareModuleKey(module.moduleKey) ?? module.id),
            badge: module.provenance ? PROVENANCE_LABEL[module.provenance] : undefined,
          })
        ),
    [modules]
  );
}
