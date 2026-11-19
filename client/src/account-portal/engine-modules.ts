export interface ModuleSummary {
  _id: string;
  name: string;
  version: string;
  author?: string;
  category?: string;
  status?: "pending" | "delivering" | "installed" | "failed";
  statusMessage?: string;
}

/** A module that is on the engine's list but not running yet or not at all. */
export function isUnsettled(module: ModuleSummary): boolean {
  return module.status !== undefined && module.status !== "installed";
}

/** The modules matching a search of name, author or category, those with a problem first, then by name. */
export function visibleModules<T extends ModuleSummary>(modules: readonly T[], search: string): T[] {
  const needle = search.trim().toLowerCase();
  return modules
    .filter((module) =>
      needle === ""
        ? true
        : [module.name, module.author, module.category].some((field) => field?.toLowerCase().includes(needle))
    )
    .sort((a, b) => Number(isUnsettled(b)) - Number(isUnsettled(a)) || a.name.localeCompare(b.name));
}
