/**
 * Wording for the entries of an uninstall refusal.
 *
 * Most entries are a resource of the module that something still uses: a
 * trigger a workflow listens to, a widget a scene places. An entry whose
 * `resourceType` is `module` is the whole module, which other installed
 * modules declare in their `requires`; the engine names each dependent as a
 * `module` source whose context is the range it requires (`requires ^1.2.0`).
 */

export const MODULE_DEPENDENCY_RESOURCE_TYPE = "module";

export function usedByHeading(resourceType: string | undefined): string {
  return resourceType === MODULE_DEPENDENCY_RESOURCE_TYPE ? "Required by:" : "Used by:";
}

/** The parenthesised note after a user's name, or null when there is nothing to add. */
export function usedByContext(resourceType: string | undefined, context: string | undefined): string | null {
  if (!context) {
    return null;
  }
  if (resourceType === MODULE_DEPENDENCY_RESOURCE_TYPE) {
    return `(${context})`;
  }
  return `(as ${context})`;
}
