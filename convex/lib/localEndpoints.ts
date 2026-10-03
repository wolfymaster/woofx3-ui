/**
 * A module's local endpoints (its manifest's `local[]`): things on the
 * streamer's own network the module needs to reach, such as OBS. A module
 * states only which of its settings hold the address and how the device can
 * be found; the platform picks the route (direct, or through the companion's
 * bridge). Must match `LocalEndpoint` in the engine's
 * barkloader/lib_module/src/local_endpoint.rs, and keep only entries its
 * `validate_local` would have installed.
 */

export type LocalProtocol = "websocket" | "http";

export interface LocalDiscover {
  /** A DNS-SD service type such as `_elg._tcp`. */
  mdns?: string;
  /** A discoverer built into the companion, such as `obs-websocket`. */
  known?: string;
}

export interface LocalEndpoint {
  id: string;
  name: string;
  protocol: LocalProtocol;
  hostSetting: string;
  portSetting: string;
  passwordSetting?: string;
  discover?: LocalDiscover;
}

/** Which part of an endpoint's address a setting holds. */
export type LocalSettingRole = "host" | "port" | "password";

const ENDPOINT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
const MDNS_SERVICE_PATTERN = /^_[a-z0-9-]{1,15}\._(tcp|udp)$/;
const MAX_NAME_CHARS = 80;
const PROTOCOLS: ReadonlySet<string> = new Set(["websocket", "http"]);

export function isLocalEndpointId(value: string): boolean {
  return ENDPOINT_ID_PATTERN.test(value);
}

/** Setting id → its manifest `type`, for the settings the manifest declares. */
function settingTypes(manifest: Record<string, unknown>): Map<string, string> {
  const types = new Map<string, string>();
  if (!Array.isArray(manifest.settings)) {
    return types;
  }
  for (const field of manifest.settings) {
    if (typeof field !== "object" || field === null) {
      continue;
    }
    const { id, type } = field as { id?: unknown; type?: unknown };
    if (typeof id === "string" && typeof type === "string") {
      types.set(id, type);
    }
  }
  return types;
}

/**
 * An optional manifest field, with an explicit `null` read as absent: the
 * engine deserializes both to `None`, so both install.
 */
function optional(value: unknown): unknown {
  return value === null ? undefined : value;
}

function readDiscover(value: unknown): LocalDiscover | undefined | null {
  const raw = optional(value);
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const fields = raw as { mdns?: unknown; known?: unknown };
  const mdns = optional(fields.mdns);
  const known = optional(fields.known);
  if (typeof mdns === "string" && known === undefined && MDNS_SERVICE_PATTERN.test(mdns)) {
    return { mdns };
  }
  if (typeof known === "string" && mdns === undefined && ENDPOINT_ID_PATTERN.test(known)) {
    return { known };
  }
  return null;
}

/**
 * The manifest's local endpoints, keeping only entries the engine would have
 * installed. A dropped entry is one this dashboard must not act on, so it is
 * as if the module never declared it.
 */
export function readLocalEndpoints(manifest: unknown): LocalEndpoint[] {
  if (typeof manifest !== "object" || manifest === null) {
    return [];
  }
  const body = manifest as Record<string, unknown>;
  if (!Array.isArray(body.local)) {
    return [];
  }
  const types = settingTypes(body);
  const ids = new Set<string>();
  const named = new Set<string>();
  const endpoints: LocalEndpoint[] = [];
  for (const entry of body.local) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const { id, name, protocol, hostSetting, portSetting } = raw;
    const passwordSetting = optional(raw.passwordSetting);
    if (typeof id !== "string" || !ENDPOINT_ID_PATTERN.test(id) || ids.has(id)) {
      continue;
    }
    if (typeof name !== "string" || name.trim().length === 0 || [...name.trim()].length > MAX_NAME_CHARS) {
      continue;
    }
    if (typeof protocol !== "string" || !PROTOCOLS.has(protocol)) {
      continue;
    }
    if (typeof hostSetting !== "string" || types.get(hostSetting) !== "text") {
      continue;
    }
    if (typeof portSetting !== "string" || types.get(portSetting) !== "number") {
      continue;
    }
    if (
      passwordSetting !== undefined &&
      (typeof passwordSetting !== "string" || types.get(passwordSetting) !== "secret")
    ) {
      continue;
    }
    const keys = [hostSetting, portSetting, ...(passwordSetting === undefined ? [] : [passwordSetting])];
    if (new Set(keys).size !== keys.length || keys.some((key) => named.has(key))) {
      continue;
    }
    const discover = readDiscover(raw.discover);
    if (discover === null) {
      continue;
    }
    ids.add(id);
    for (const key of keys) {
      named.add(key);
    }
    endpoints.push({
      id,
      name: name.trim(),
      protocol: protocol as LocalProtocol,
      hostSetting,
      portSetting,
      ...(passwordSetting === undefined ? {} : { passwordSetting }),
      ...(discover === undefined ? {} : { discover }),
    });
  }
  return endpoints;
}

/** The setting keys an endpoint names, host first. */
export function localSettingKeys(endpoint: LocalEndpoint): string[] {
  return [endpoint.hostSetting, endpoint.portSetting, ...(endpoint.passwordSetting ? [endpoint.passwordSetting] : [])];
}

/** The endpoint that names a setting, and which part of the address it holds; null for any other setting. */
export function localEndpointOwningSetting(
  manifest: unknown,
  key: string
): { endpoint: LocalEndpoint; role: LocalSettingRole } | null {
  for (const endpoint of readLocalEndpoints(manifest)) {
    if (endpoint.hostSetting === key) {
      return { endpoint, role: "host" };
    }
    if (endpoint.portSetting === key) {
      return { endpoint, role: "port" };
    }
    if (endpoint.passwordSetting === key) {
      return { endpoint, role: "password" };
    }
  }
  return null;
}

const MAX_HOSTNAME_CHARS = 253;
const HOSTNAME_LABEL_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;
const NUMERIC_DOTTED_PATTERN = /^[\d.]+$/;

/**
 * A host the companion may report it dials: an IP literal (IPv6 without
 * brackets) or a DNS name. Never a scheme, path, port or userinfo; the port
 * travels separately.
 */
export function isEndpointHost(host: string): boolean {
  if (IPV4_PATTERN.test(host)) {
    return true;
  }
  if (host.includes(":")) {
    return IPV6_PATTERN.test(host) && isIpv6Literal(host);
  }
  if (host.length === 0 || host.length > MAX_HOSTNAME_CHARS || NUMERIC_DOTTED_PATTERN.test(host)) {
    return false;
  }
  return host.split(".").every((label) => HOSTNAME_LABEL_PATTERN.test(label));
}

/** The URL parser is the IPv6 grammar; a bracketed literal it accepts is one. */
function isIpv6Literal(host: string): boolean {
  try {
    return new URL(`http://[${host}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

export function isEndpointPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** What the companion found for an endpoint. It sends the password only when the streamer opted in. */
export interface CompanionReport {
  host?: string;
  port?: number;
  password?: string;
}

/** Who last wrote one setting; see `moduleSettingProvenance` in schema.ts. */
export interface SettingProvenance {
  key: string;
  source: "companion" | "manual";
  companionValue?: string;
}

export interface CompanionWrite {
  key: string;
  value: string;
  /** A secret's value is never kept in Convex, so it is not compared or recorded. */
  secret: boolean;
}

/**
 * The module settings a companion report should change. Only keys the
 * endpoint names, never one the streamer set by hand, and not a value the
 * companion already wrote: every setting write makes the engine reconnect to
 * the endpoint, so an unchanged report must write nothing. Throws on a report
 * that is not an address, and on a password the companion may not provide
 * (`secretAllowed`: the streamer chose to share it, the endpoint is on, and
 * its discoverer may hand this module a secret).
 */
export function planCompanionWrites(
  endpoint: LocalEndpoint,
  report: CompanionReport,
  provenance: readonly SettingProvenance[],
  secretAllowed: boolean
): CompanionWrite[] {
  if (report.host !== undefined && !isEndpointHost(report.host)) {
    throw new Error("The reported host is not a host name or IP address.");
  }
  if (report.port !== undefined && !isEndpointPort(report.port)) {
    throw new Error("The reported port is not an integer from 1 to 65535.");
  }
  if (report.password !== undefined && endpoint.passwordSetting && !secretAllowed) {
    throw new Error("The companion may not provide this endpoint's password.");
  }
  const byKey = new Map(provenance.map((row) => [row.key, row]));
  const writes: CompanionWrite[] = [];
  const consider = (key: string, value: string, secret: boolean) => {
    const row = byKey.get(key);
    if (row?.source === "manual") {
      return;
    }
    if (!secret && row?.source === "companion" && row.companionValue === value) {
      return;
    }
    writes.push({ key, value, secret });
  };
  if (report.host !== undefined) {
    consider(endpoint.hostSetting, report.host, false);
  }
  if (report.port !== undefined) {
    consider(endpoint.portSetting, String(report.port), false);
  }
  if (report.password !== undefined && endpoint.passwordSetting) {
    consider(endpoint.passwordSetting, report.password, true);
  }
  return writes;
}
