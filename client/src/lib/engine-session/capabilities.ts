import {
  ENGINE_CAPABILITIES,
  ENGINE_CAPABILITIES_SCHEMA,
  type EngineCapabilities,
  type EngineCapability,
} from "@woofx3/api";

const KNOWN: ReadonlySet<string> = new Set(Object.values(ENGINE_CAPABILITIES));

export type CapabilityReading = { ok: true; capabilities: EngineCapability[] } | { ok: false; error: string };

/**
 * The capability ids in an engine's `getEngineCapabilities` answer that the
 * engine contract this build compiles against declares, sorted and unique.
 * Ids from a newer engine are dropped. A different `schema` is not a flat id
 * list, and guessing at it could offer a feature the engine lacks, so it is
 * refused.
 */
export function readEngineCapabilities(report: EngineCapabilities): CapabilityReading {
  if (report.schema !== ENGINE_CAPABILITIES_SCHEMA || !Array.isArray(report.capabilities)) {
    return { ok: false, error: `unreadable capability report (schema ${String(report.schema)})` };
  }
  const known = new Set(report.capabilities.filter((id): id is EngineCapability => KNOWN.has(id)));
  return { ok: true, capabilities: [...known].sort() };
}
