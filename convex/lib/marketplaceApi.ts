/**
 * Talking to the marketplace API (`woofx3-marketplace-api`).
 *
 * That service owns the catalog; this deployment is a proxy in front of it and
 * keeps no copy. Two credentials are involved and they are not
 * interchangeable:
 *
 * - `MARKETPLACE_DEV_TOKEN` is read-only and reveals dev-tier listings. It is
 *   attached only for instances an operator flagged (see marketplaceAccess.ts).
 * - `MARKETPLACE_API_TOKEN` is the write token. It authorises checkout and the
 *   entitlement reads, which are credential-gated because purchase history is
 *   not anonymous-safe. It must never reach the browser.
 *
 * Reads with no credential are the normal case: the catalog is public.
 */

import { type MarketplaceAccess, marketplaceRequestHeaders } from "./marketplaceAccess";

const MARKETPLACE_TIMEOUT_MS = 10_000;

/** The marketplace API's origin, without a trailing slash. */
export function marketplaceBaseUrl(): string {
  const url = process.env.MARKETPLACE_API_URL;
  if (!url) {
    throw new Error("Marketplace not configured: set MARKETPLACE_API_URL");
  }
  return url.replace(/\/$/, "");
}

/** Raised for a non-2xx answer, carrying the marketplace's own error code. */
export class MarketplaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

async function send(path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARKETPLACE_TIMEOUT_MS);
  try {
    const res = await fetch(`${marketplaceBaseUrl()}${path}`, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw errorFrom(res.status, text, path);
    }
    return text === "" ? null : JSON.parse(text);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Marketplace request to ${path} timed out after ${MARKETPLACE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The marketplace's error envelope is always `{error: {code, message}}`, so
 * the code is what call sites branch on rather than parsing a message.
 */
function errorFrom(status: number, body: string, path: string): MarketplaceError {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof parsed.error?.code === "string" ? parsed.error.code : "unknown";
    const message = typeof parsed.error?.message === "string" ? parsed.error.message : body;
    return new MarketplaceError(status, code, message);
  } catch {
    return new MarketplaceError(status, "unknown", `Marketplace request to ${path} failed: ${status}`);
  }
}

/** A catalog read at `access`. No credential unless the instance is flagged. */
export async function marketplaceGet(path: string, access: MarketplaceAccess): Promise<unknown> {
  return await send(path, {
    method: "GET",
    headers: marketplaceRequestHeaders(access, process.env.MARKETPLACE_DEV_TOKEN),
  });
}

/**
 * A read or write that needs the marketplace's write token: checkout, grants,
 * and the entitlement reads.
 *
 * Throws rather than falling back to an anonymous request when the token is
 * unset. An anonymous entitlement read is a 401, and a buyer seeing "not
 * entitled" because a server variable is missing would look exactly like a
 * refund gone wrong.
 */
export async function marketplaceAuthed(path: string, method: string, body?: unknown): Promise<unknown> {
  const token = process.env.MARKETPLACE_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Marketplace commerce requires MARKETPLACE_API_TOKEN to be set");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return await send(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The query string for a set of parameters, dropping the ones with no value. */
export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}
