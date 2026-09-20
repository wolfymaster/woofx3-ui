/**
 * A resource kind a module declares in its manifest's `resources[]`: the
 * custom-resource definition an instance is created from.
 *
 * `schema` is the create-instance form, as config fields — the same field
 * vocabulary an action or trigger declares, so it renders through the same form.
 * The engine never reads it; it only keeps what the form produced.
 */
export interface ManifestResourceKind {
  kind: string;
  name: string;
  description: string;
  /** A lucide icon name, when the module chose one. */
  icon?: string;
  schema: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseManifestResourceKinds(manifest: unknown): ManifestResourceKind[] {
  const resources = asRecord(manifest).resources;
  if (!Array.isArray(resources)) {
    return [];
  }
  return resources
    .map((raw): ManifestResourceKind => {
      const entry = asRecord(raw);
      const icon = asString(entry.icon);
      return {
        kind: asString(entry.kind),
        name: asString(entry.name),
        description: asString(entry.description),
        ...(icon ? { icon } : {}),
        schema: Array.isArray(entry.schema) ? entry.schema : [],
      };
    })
    .filter((kind) => kind.kind);
}

/** The manifest id a module is addressed by — the first segment of its canonical ids. */
export function manifestModuleName(manifest: unknown, fallback: string): string {
  return asString(asRecord(manifest).id) || fallback;
}
