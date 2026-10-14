import { type NotificationContent, type ParseResult, parseNotificationContent } from "../notifications";

/** A new notification as the backoffice sends it. Audience ids are unchecked strings until the mutation resolves them. */
export interface NotificationRequest extends NotificationContent {
  requestId: string;
  audience: { kind: "all" } | { kind: "account"; accountId: string } | { kind: "user"; userId: string };
}

const MAX_REQUEST_ID_LENGTH = 100;
const MAX_ID_LENGTH = 64;

export function parseNotificationRequest(body: unknown): ParseResult<NotificationRequest> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const raw = body as Record<string, unknown>;
  const requestId = raw.requestId;
  if (typeof requestId !== "string" || requestId === "" || requestId.length > MAX_REQUEST_ID_LENGTH) {
    return { ok: false, message: `requestId must be 1 to ${MAX_REQUEST_ID_LENGTH} characters` };
  }
  const content = parseNotificationContent({ heading: raw.heading, description: raw.description, link: raw.link });
  if (!content.ok) {
    return content;
  }
  const audience = parseAudience(raw.audience);
  if (audience === null) {
    return {
      ok: false,
      message: 'audience must be { kind: "all" }, { kind: "account", accountId } or { kind: "user", userId }',
    };
  }
  return { ok: true, value: { ...content.value, requestId, audience } };
}

function parseAudience(raw: unknown): NotificationRequest["audience"] | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const audience = raw as Record<string, unknown>;
  if (audience.kind === "all") {
    return { kind: "all" };
  }
  if (audience.kind === "account" && isId(audience.accountId)) {
    return { kind: "account", accountId: audience.accountId };
  }
  if (audience.kind === "user" && isId(audience.userId)) {
    return { kind: "user", userId: audience.userId };
  }
  return null;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= MAX_ID_LENGTH;
}
