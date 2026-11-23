import { Link } from "wouter";
import { LIST_RAIL } from "@/components/layout/sidebar-rail";
import { getCategoryColor } from "@/components/modules/module-category";
import type { InstalledModule, ModuleProvenance } from "@/engine/types";
import { bareModuleKey } from "@/lib/module-key";
import { cn } from "@/lib/utils";

const PROVENANCE_LABEL: { readonly [P in ModuleProvenance]: string } = {
  builtIn: "Built in",
  marketplace: "Marketplace",
  uploaded: "Uploaded",
};

/** The id a module's page is routed by: its bare module key, or its row id when it has none. */
export function moduleRouteId(module: InstalledModule): string {
  return bareModuleKey(module.moduleKey) ?? module.id;
}

interface InstalledModuleRailProps {
  title: string;
  modules: InstalledModule[];
  /** The route's module id, or undefined when the route names none. */
  selectedId: string | undefined;
  hrefFor: (moduleId: string) => string;
}

/** The list rail of installed modules, shared by the module pages and the settings page. */
export function InstalledModuleRail({ title, modules, selectedId, hrefFor }: InstalledModuleRailProps) {
  return (
    <nav className={cn(LIST_RAIL, "md:overflow-y-auto")} aria-label={title}>
      <div className="border-b border-border px-4 py-3 text-sm font-medium">{title}</div>
      <ul className="p-2 space-y-0.5">
        {modules.map((module) => {
          const routeId = moduleRouteId(module);
          const active = selectedId === routeId || selectedId === module.id;
          return (
            <li key={module.id}>
              <Link
                href={hrefFor(routeId)}
                aria-current={active ? "page" : undefined}
                data-testid={`module-rail-${module.id}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent",
                  active && "bg-accent font-medium"
                )}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                  style={{ backgroundColor: getCategoryColor(module.category) }}
                  aria-hidden="true"
                >
                  {module.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{module.name}</span>
                {module.provenance && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {PROVENANCE_LABEL[module.provenance]}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
