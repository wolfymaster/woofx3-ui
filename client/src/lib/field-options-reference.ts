import type { FieldOptionsDeclaration, FieldOptionsReference } from "@convex/lib/fieldOptions";
import type { ConfigField, InternalConfigFieldSource } from "@woofx3/api/ui-schema";

/**
 * The declaration a form's fields came from: everything a field reference
 * needs except the field's own id.
 */
export type FieldOptionsOwner = Omit<FieldOptionsReference, "fieldId">;

/**
 * An `internal` source the UI has told where it was declared. The engine
 * answers a field by that reference and never by the request the source
 * describes, so a source without one cannot be asked for its options.
 */
export type ReferencedInternalSource = InternalConfigFieldSource & { reference?: FieldOptionsReference };

const CANONICAL_DECLARATIONS: ReadonlySet<string> = new Set<FieldOptionsDeclaration>(["trigger", "action", "widget"]);

/**
 * The owner named by a trigger, action or widget canonical id
 * (`{moduleId}:{kind}:{id}`), or undefined when there is none. Segments never
 * contain `:`, so the id splits into exactly three.
 */
export function fieldOptionsOwnerFromCanonicalId(canonicalId: string | undefined): FieldOptionsOwner | undefined {
  const parts = canonicalId?.split(":") ?? [];
  if (parts.length !== 3) {
    return undefined;
  }
  const [moduleId, kind, declarationId] = parts;
  if (!moduleId || !declarationId || !CANONICAL_DECLARATIONS.has(kind)) {
    return undefined;
  }
  return { moduleId, declaration: kind as FieldOptionsDeclaration, declarationId };
}

/** The owner of a module-declared resource kind's form, or undefined without a module. */
export function resourceKindFieldOptionsOwner(
  moduleId: string | undefined,
  kind: string
): FieldOptionsOwner | undefined {
  if (!moduleId || !kind) {
    return undefined;
  }
  return { moduleId, declaration: "resource", declarationId: kind };
}

/** The reference a module settings `button` is pressed by, or undefined without a module. */
export function settingFieldOptionsReference(
  moduleId: string | undefined,
  fieldId: string
): FieldOptionsReference | undefined {
  if (!moduleId || !fieldId) {
    return undefined;
  }
  return { moduleId, declaration: "setting", fieldId };
}

/**
 * Tell every `internal` source among `fields` where it was declared, so the
 * picker rendering it can ask the engine for that field's options. Fields are
 * rendered far from where they are loaded, and a ConfigField carries no link
 * to its declaration, so the reference rides on the source the same way
 * `withModuleName` attaches a module name.
 */
export function withFieldOptionsOwner(fields: ConfigField[], owner: FieldOptionsOwner | undefined): ConfigField[] {
  if (!owner) {
    return fields;
  }
  return fields.map((field) => {
    if (field.source?.kind !== "internal") {
      return field;
    }
    const source: ReferencedInternalSource = { ...field.source, reference: { ...owner, fieldId: field.id } };
    return { ...field, source };
  });
}

/** The reference a source was given by `withFieldOptionsOwner`, if any. */
export function fieldOptionsReferenceOf(
  source: InternalConfigFieldSource | undefined
): FieldOptionsReference | undefined {
  return (source as ReferencedInternalSource | undefined)?.reference;
}

/** Why a field's options cannot be requested when its source was never given a reference. */
export const MISSING_FIELD_OPTIONS_REFERENCE =
  "This field does not say which module declared it, so its options cannot be requested.";
