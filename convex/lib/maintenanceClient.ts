/**
 * Typed client for the woofx3 maintenance API — the service that creates and
 * tears down managed engines.
 *
 * Every call is server-side: the API key grants the power to create engines
 * for any account this deployment owns, so it never reaches a browser. The
 * shapes below mirror the maintenance API's `EngineSchema` / `RunSchema`; only
 * the fields the UI actually reads are declared, since a response gaining a
 * field must not break this client.
 */

/** A non-2xx answer, carrying the API's stable error code so callers can branch on it. */
export class MaintenanceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MaintenanceApiError";
  }
}

export type MaintenanceEngineStatus = "provisioning" | "ready" | "failed" | "deprovisioning" | "deleted";
export type MaintenanceStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type MaintenanceRunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface MaintenanceEngine {
  id: string;
  slug: string;
  kind: "customer" | "preview";
  externalRef: string | null;
  status: MaintenanceEngineStatus;
  desiredVersion: string;
  reportedVersion: string | null;
  publicUrl: string | null;
  /** Set when the engine needs an operator's attention; surfaced on the admin page. */
  flag: { at: string; reason: string } | null;
}

export interface MaintenanceRunStep {
  key: string;
  label: string;
  status: MaintenanceStepStatus;
  error: { code: string; message: string } | null;
}

export interface MaintenanceRun {
  id: string;
  kind: "provision" | "deprovision" | "redeploy";
  status: MaintenanceRunStatus;
  currentStep: string;
  error: { code: string; message: string; step: string } | null;
  steps?: MaintenanceRunStep[];
}

export interface CreateEngineInput {
  slug: string;
  owner: { type: string; ref: string };
  externalRef: string;
  registrationToken: string;
  callbackUrl: string;
  twitchChannel?: string;
  version?: string;
}

export interface CreatedEngine {
  engine: MaintenanceEngine;
  run: MaintenanceRun;
  /** Only present when the maintenance API generated the token, which it does not when we supply one. */
  registrationToken?: string;
}

export interface SlugAvailability {
  available: boolean;
  reason?: string;
}

/** The owner type this deployment registers engines under; the API key is scoped to it. */
export const MAINTENANCE_OWNER_TYPE = "woofx3-ui";

interface MaintenanceConfig {
  baseUrl: string;
  apiKey: string;
}

/** Whether managed engines can be offered at all — both variables are set on deployments that have the service. */
export function isMaintenanceConfigured(): boolean {
  return Boolean(process.env.MAINTENANCE_API_URL && process.env.MAINTENANCE_API_KEY);
}

function requireConfig(): MaintenanceConfig {
  const baseUrl = process.env.MAINTENANCE_API_URL;
  const apiKey = process.env.MAINTENANCE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Managed engines are not configured (MAINTENANCE_API_URL / MAINTENANCE_API_KEY)");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

async function request<T>(path: string, init: { method: string; body?: unknown; idempotencyKey?: string }): Promise<T> {
  const config = requireConfig();
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new MaintenanceApiError(response.status, ...errorFrom(text, response.status));
  }
  return JSON.parse(text) as T;
}

/** The API answers `{ error: { code, message } }`; anything else (a proxy's HTML, say) still needs a code. */
function errorFrom(text: string, status: number): [code: string, message: string] {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.code === "string" && typeof parsed.error?.message === "string") {
      return [parsed.error.code, parsed.error.message];
    }
  } catch {
    // Falls through to the generic code below.
  }
  return ["http_error", `Maintenance API returned ${status}`];
}

/**
 * Create an engine and start its provisioning run.
 *
 * `idempotencyKey` must be stable per engine the caller means to create (the
 * provisioning row id), so a retried action returns the original run instead
 * of provisioning a second engine.
 */
export function createEngine(input: CreateEngineInput, idempotencyKey: string): Promise<CreatedEngine> {
  return request<CreatedEngine>("/v1/engines", {
    method: "POST",
    idempotencyKey,
    body: { kind: "customer", version: "latest", ...input },
  });
}

export function checkSlugAvailability(slug: string): Promise<SlugAvailability> {
  return request<SlugAvailability>(`/v1/slugs/${encodeURIComponent(slug)}?kind=customer`, { method: "GET" });
}

/** Resume a failed run from the step it failed on. */
export function retryRun(
  engineId: string,
  runId: string,
  idempotencyKey: string
): Promise<{ engine: MaintenanceEngine; run: MaintenanceRun }> {
  return request(`/v1/engines/${encodeURIComponent(engineId)}/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
    idempotencyKey,
  });
}

/** Start a deprovision run: the route, the container, the database and the role all go. */
export function deleteEngine(
  engineId: string,
  idempotencyKey: string
): Promise<{ engine: MaintenanceEngine; run: MaintenanceRun }> {
  return request(`/v1/engines/${encodeURIComponent(engineId)}`, { method: "DELETE", idempotencyKey });
}
