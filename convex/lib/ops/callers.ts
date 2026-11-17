import type { OpsRoute } from "./routes";

export type OpsRouteName = OpsRoute["name"];

export interface OpsCaller {
  /** Recorded on every audit row the caller's requests write. */
  name: string;
  /** Prefix of the Convex env vars holding the secret; `<prefix>_NEXT` is the rotation slot. */
  envPrefix: string;
  /** The routes the caller may use; any other route answers 403. */
  scopes: ReadonlySet<OpsRouteName>;
  /** True for a caller kept only until its holders move to a named caller. */
  deprecated: boolean;
}

const OPS_SECRET_ENV_BASE = "OPS_API_SECRET";

/** Env var holding a caller's secret, derived from its name: `billing` is `OPS_API_SECRET_BILLING`. */
export function callerSecretEnv(callerName: string): string {
  return `${OPS_SECRET_ENV_BASE}_${callerName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function nextSecretEnv(secretEnv: string): string {
  return `${secretEnv}_NEXT`;
}

function namedCaller(name: string, scopes: readonly OpsRouteName[]): OpsCaller {
  return { name, envPrefix: callerSecretEnv(name), scopes: new Set(scopes), deprecated: false };
}

const BACKOFFICE_SCOPES: readonly OpsRouteName[] = [
  "users.list",
  "users.get",
  "accounts.list",
  "accounts.get",
  "engines.list",
  "engines.moduleStorageLimits",
  "engines.eventPath",
  "engines.byMaintenanceId",
  "instances.health",
  "audit.list",
  "notifications.list",
  "engines.act",
  "instances.setStorageLimits",
  "notifications.create",
  "notifications.delete",
  "accounts.billingProjectionReset",
];

/**
 * The internet-facing maintenance billing process holds only what billing
 * itself calls: identity reads, the projection push and notices. A leak of
 * its secret cannot act on engines or reset a projection.
 */
const BILLING_SCOPES: readonly OpsRouteName[] = [
  "users.get",
  "accounts.get",
  "accounts.billingProjection",
  "notifications.create",
];

/**
 * Every caller the ops API knows, in the order a presented secret is
 * matched. The `legacy` entry is the old shared secret and may use every
 * route; deleting its entry retires it.
 */
export const OPS_CALLERS: readonly OpsCaller[] = [
  namedCaller("billing", BILLING_SCOPES),
  namedCaller("backoffice", BACKOFFICE_SCOPES),
  {
    name: "legacy",
    envPrefix: OPS_SECRET_ENV_BASE,
    scopes: new Set<OpsRouteName>([...BACKOFFICE_SCOPES, "accounts.billingProjection"]),
    deprecated: true,
  },
];

export function callerMayUse(caller: OpsCaller, route: OpsRouteName): boolean {
  return caller.scopes.has(route);
}
