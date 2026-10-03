import type { RpcTarget } from "@woofx3/api/client";
import { createEngineRpcSession } from "./engineInstanceUrl";

/**
 * Engine feature detection. An engine lists the features its build supports
 * through `getEngineCapabilities()`, and the UI gates newer features on those
 * ids rather than on the engine version, which is an image tag.
 *
 * Declared here because the engine checkout this repo builds against may
 * predate the method. The response shape must match `EngineCapabilities` and
 * `ENGINE_CAPABILITIES_SCHEMA`, and every id must match an entry of
 * `ENGINE_CAPABILITIES`, in woofx3 `shared/clients/typescript/api/capabilities.ts`
 * (see woofx3 docs/services/engine-capabilities.md).
 */

/** The ids this UI gates on. Ids an engine lists beyond these are ignored. */
export const ENGINE_CAPABILITY_IDS = [
  "alerts.queueControls",
  "analytics.aggregates",
  "analytics.gauges",
  "analytics.sessions",
  "config.bundles",
  "modules.localEndpoints",
  "modules.oauth",
  "obs.control",
  "obs.status",
  "twitch.dashboardTokens",
  "widgets.themes",
  "workflow.delayWait",
  "workflow.dryRun",
  "workflow.health",
  "workflow.realCancel",
  "workflow.reservedSubjects",
  "workflow.testRunOptions",
] as const;

export type EngineCapability = (typeof ENGINE_CAPABILITY_IDS)[number];

const KNOWN_IDS: ReadonlySet<string> = new Set(ENGINE_CAPABILITY_IDS);

/** The only response shape this UI reads. */
export const ENGINE_CAPABILITIES_SCHEMA = 1;

export interface EngineCapabilitiesResponse {
  schema: typeof ENGINE_CAPABILITIES_SCHEMA;
  capabilities: string[];
}

export interface EngineCapabilitiesApi extends RpcTarget {
  getEngineCapabilities(): Promise<EngineCapabilitiesResponse>;
}

/**
 * What an engine supports, as far as this UI cares. `legacy` is an engine
 * that predates `getEngineCapabilities` and so supports none of the ids.
 */
export interface EngineCapabilityReport {
  legacy: boolean;
  /** Known ids only, sorted and unique. */
  capabilities: EngineCapability[];
}

export const LEGACY_ENGINE_REPORT: EngineCapabilityReport = { legacy: true, capabilities: [] };

const CAPABILITIES_METHOD = "getEngineCapabilities";

/**
 * True for capnweb's refusal of a method the engine does not expose, which is
 * how an engine older than capabilities answers. Any other error is a real
 * failure and must surface as one.
 */
export function isLegacyCapabilitiesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(`'${CAPABILITIES_METHOD}' is not a function`);
}

/**
 * Reads an engine's answer, keeping only ids this UI knows. Throws on a shape
 * it cannot read: a new `schema` means the answer is no longer a flat id list,
 * and guessing at it could show a feature the engine does not have.
 */
export function parseEngineCapabilities(raw: unknown): EngineCapabilityReport {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Engine answered ${CAPABILITIES_METHOD} with ${JSON.stringify(raw)}`);
  }
  const body = raw as { schema?: unknown; capabilities?: unknown };
  if (body.schema !== ENGINE_CAPABILITIES_SCHEMA) {
    throw new Error(
      `Engine answered ${CAPABILITIES_METHOD} with schema ${String(body.schema)}; this dashboard reads schema ${ENGINE_CAPABILITIES_SCHEMA}`
    );
  }
  if (!Array.isArray(body.capabilities)) {
    throw new Error(`Engine answered ${CAPABILITIES_METHOD} without a capabilities list`);
  }
  const known = new Set<EngineCapability>();
  for (const id of body.capabilities) {
    if (typeof id === "string" && KNOWN_IDS.has(id)) {
      known.add(id as EngineCapability);
    }
  }
  return { legacy: false, capabilities: Array.from(known).sort() };
}

export function hasEngineCapability(report: EngineCapabilityReport, id: EngineCapability): boolean {
  return report.capabilities.includes(id);
}

/**
 * Asks the engine what it supports. Uses its own capnweb session, since an
 * HTTP batch session is spent by its first call.
 */
export async function fetchEngineCapabilities(engine: {
  url: string;
  clientId: string;
  clientSecret: string;
}): Promise<EngineCapabilityReport> {
  try {
    const raw = await createEngineRpcSession<EngineCapabilitiesApi>(
      engine.url,
      engine.clientId,
      engine.clientSecret
    ).getEngineCapabilities();
    return parseEngineCapabilities(raw);
  } catch (error) {
    if (isLegacyCapabilitiesError(error)) {
      return LEGACY_ENGINE_REPORT;
    }
    throw error;
  }
}
