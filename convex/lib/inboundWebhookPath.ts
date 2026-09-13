const INBOUND_WEBHOOK_PATH = /^\/api\/webhooks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type InboundWebhookPath = { ok: true; endpointId: string } | { ok: false };

/**
 * The endpoint id in a third-party webhook path, `/api/webhooks/<uuid>`.
 * Anything else — the engine callback's `woofx3` segment, extra segments, a
 * missing or malformed id — is not an inbound webhook.
 */
export function parseInboundWebhookPath(pathname: string): InboundWebhookPath {
  const match = INBOUND_WEBHOOK_PATH.exec(pathname);
  if (!match?.[1]) {
    return { ok: false };
  }
  return { ok: true, endpointId: match[1].toLowerCase() };
}
