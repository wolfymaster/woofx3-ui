import { CircleHelp, type LucideIcon, type LucideProps } from "lucide-react";
import { forwardRef, lazy, Suspense } from "react";
import { kebabToPascal } from "@/lib/lucide-names";
import { cn } from "@/lib/utils";

type IconModule = { default: LucideIcon };
type IconLoader = () => Promise<IconModule>;

interface LucideCatalog {
  /** Every canonical and legacy PascalCase name, to the loader of its icon chunk. */
  loaders: ReadonlyMap<string, IconLoader>;
  /** Canonical PascalCase names only, sorted, so a picker offers each icon once. */
  names: readonly string[];
}

let catalog: Promise<LucideCatalog> | null = null;

/**
 * Loads the name-to-chunk map for all of Lucide. The map alone is tens of KB,
 * so it is fetched on demand: the first time an icon outside ICON_SET renders,
 * or when the icon picker needs the full list. A failed load is not cached, so
 * the next caller retries.
 */
export function loadLucideCatalog(): Promise<LucideCatalog> {
  if (catalog) {
    return catalog;
  }
  catalog = Promise.all([import("lucide-react/dynamicIconImports"), import("@/lib/lucide-aliases.generated")]).then(
    ([{ default: imports }, { LUCIDE_ALIASES }]) => {
      const loaders = new Map<string, IconLoader>();
      for (const [kebab, load] of Object.entries(imports)) {
        loaders.set(kebabToPascal(kebab), load);
      }
      const names = Array.from(loaders.keys()).sort();
      for (const [alias, kebab] of Object.entries(LUCIDE_ALIASES)) {
        const load = imports[kebab as keyof typeof imports];
        if (load) {
          loaders.set(alias, load);
        }
      }
      return { loaders, names };
    },
    (error: unknown) => {
      catalog = null;
      throw error;
    }
  );
  return catalog;
}

async function loadIcon(name: string): Promise<IconModule> {
  try {
    const load = (await loadLucideCatalog()).loaders.get(name);
    if (!load) {
      return { default: CircleHelp };
    }
    return await load();
  } catch {
    return { default: CircleHelp };
  }
}

/**
 * Stands in for an icon while its chunk loads. It is an empty svg with the
 * same size and classes a Lucide icon renders with, so the swap does not shift
 * layout.
 */
const IconPlaceholder = forwardRef<SVGSVGElement, Omit<LucideProps, "ref">>(({ size = 24, className, style }, ref) => (
  <svg ref={ref} width={size} height={size} className={cn("lucide", className)} style={style} aria-hidden="true" />
));
IconPlaceholder.displayName = "IconPlaceholder";

const dynamicIcons = new Map<string, LucideIcon>();

/**
 * A component for the Lucide icon `name` (PascalCase, canonical or legacy)
 * that loads the icon's own chunk on first render. Unknown names render
 * CircleHelp. Each icon carries its own Suspense boundary so a loading icon
 * never suspends the surrounding page. Components are cached per name, keeping
 * their identity stable across renders.
 */
export function dynamicLucideIcon(name: string): LucideIcon {
  const cached = dynamicIcons.get(name);
  if (cached) {
    return cached;
  }
  const LazyIcon = lazy(() => loadIcon(name));
  const Icon = forwardRef<SVGSVGElement, Omit<LucideProps, "ref">>((props, ref) => (
    <Suspense fallback={<IconPlaceholder ref={ref} {...props} />}>
      <LazyIcon ref={ref} {...props} />
    </Suspense>
  ));
  Icon.displayName = `DynamicLucideIcon(${name})`;
  dynamicIcons.set(name, Icon);
  return Icon;
}
