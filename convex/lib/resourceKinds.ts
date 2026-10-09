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
  /**
   * Where in an instance's value the reading shown beside its name is: object keys
   * and list indexes joined by `.`. Absent means the whole value.
   */
  summaryPath?: string;
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
      const summaryPath = asString(asRecord(entry.display).summary);
      return {
        kind: asString(entry.kind),
        name: asString(entry.name),
        description: asString(entry.description),
        ...(icon ? { icon } : {}),
        schema: Array.isArray(entry.schema) ? entry.schema : [],
        ...(summaryPath ? { summaryPath } : {}),
      };
    })
    .filter((kind) => kind.kind);
}

/** The manifest id a module is addressed by — the first segment of its canonical ids. */
export function manifestModuleName(manifest: unknown, fallback: string): string {
  return asString(asRecord(manifest).id) || fallback;
}

/**
 * The kinds the bundled woofx3 module declares, which the first-party Counters,
 * Timers and Queues pages show. A kind is identified by its module and its name,
 * `{module}:{kind}`, because two modules may each declare a kind of the same name.
 */
export const COUNTER_KIND = "woofx3:counter";
export const TIMER_KIND = "woofx3:timer";
export const QUEUE_KIND = "woofx3:queue";

/** A `resourceKind` value split: `module` is absent for a bare kind. */
export interface KindRef {
  module?: string;
  kind: string;
}

/**
 * `kind` or `module:kind`, as a `resource_ref` field names a kind. An engine
 * qualifies every kind when it installs a module, but a module installed by an
 * earlier engine still holds bare ones. Null for anything else.
 */
export function parseKindRef(ref: string): KindRef | null {
  const parts = ref.split(":");
  if (parts.some((part) => part === "") || parts.length > 2) {
    return null;
  }
  return parts.length === 2 ? { module: parts[0], kind: parts[1] } : { kind: parts[0] };
}

/** The kind's own name, without its module: what a page calls it. */
export function bareKind(ref: string): string {
  return parseKindRef(ref)?.kind ?? ref;
}

/**
 * Whether a `resource_ref` field naming `fieldKind` picks instances of the kind
 * `qualifiedKind`. A bare field kind matches by name, which is all a module
 * installed before kinds were qualified can say.
 */
export function resourceKindMatches(fieldKind: string | undefined, qualifiedKind: string): boolean {
  const field = fieldKind ? parseKindRef(fieldKind) : null;
  const target = parseKindRef(qualifiedKind);
  if (!field || !target) {
    return false;
  }
  return field.kind === target.kind && (field.module === undefined || field.module === target.module);
}

/** A module's manifest id and the kinds its manifest declares. */
export interface KindDeclarer {
  moduleName: string;
  kinds: ManifestResourceKind[];
}

/**
 * The module and declaration a kind reference means: a qualified kind names its
 * module, and a bare kind means the one module declaring it. Null when nothing
 * matches, or when several modules declare a bare kind and it cannot say which.
 */
export function resolveResourceKind(
  declarers: KindDeclarer[],
  ref: string
): { moduleName: string; declaration: ManifestResourceKind } | null {
  const parsed = parseKindRef(ref);
  if (!parsed) {
    return null;
  }
  const matches = declarers.flatMap((declarer) =>
    declarer.kinds
      .filter((declaration) => declaration.kind === parsed.kind)
      .filter(() => parsed.module === undefined || declarer.moduleName === parsed.module)
      .map((declaration) => ({ moduleName: declarer.moduleName, declaration }))
  );
  return matches.length === 1 ? matches[0] : null;
}
