import { type Infer, v } from "convex/values";

// The rules for an in-app notification's content, kept free of ctx so they
// can be tested directly. The backoffice checks the same limits in its form;
// these are the ones that decide.

export const NOTIFICATION_HEADING_MAX = 50;
export const NOTIFICATION_DESCRIPTION_MAX = 150;
export const NOTIFICATION_LINK_MAX = 500;

/** Who a notification is delivered to. Fixed when it is created: users who join later do not receive it. */
export const notificationAudienceValidator = v.union(
  v.object({ kind: v.literal("all") }),
  v.object({ kind: v.literal("account"), accountId: v.id("accounts") }),
  v.object({ kind: v.literal("user"), userId: v.id("users") })
);
export type NotificationAudience = Infer<typeof notificationAudienceValidator>;

export interface NotificationContent {
  heading: string;
  description: string;
  /** An internal path ("/admin/engine") or an absolute https URL. */
  link: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseNotificationContent(raw: {
  heading: unknown;
  description: unknown;
  link: unknown;
}): ParseResult<NotificationContent> {
  if (typeof raw.heading !== "string" || typeof raw.description !== "string") {
    return { ok: false, message: "heading and description must be strings" };
  }
  const heading = raw.heading.trim();
  const description = raw.description.trim();
  if (heading.length === 0 || heading.length > NOTIFICATION_HEADING_MAX) {
    return { ok: false, message: `heading must be 1 to ${NOTIFICATION_HEADING_MAX} characters` };
  }
  if (description.length === 0 || description.length > NOTIFICATION_DESCRIPTION_MAX) {
    return { ok: false, message: `description must be 1 to ${NOTIFICATION_DESCRIPTION_MAX} characters` };
  }
  if (raw.link !== null && raw.link !== undefined && typeof raw.link !== "string") {
    return { ok: false, message: "link must be a string or null" };
  }
  const link = typeof raw.link === "string" ? raw.link.trim() : "";
  if (link === "") {
    return { ok: true, value: { heading, description, link: null } };
  }
  if (notificationLinkKind(link) === null) {
    return {
      ok: false,
      message: `link must be a path in the app starting with "/" or an https:// URL, at most ${NOTIFICATION_LINK_MAX} characters`,
    };
  }
  return { ok: true, value: { heading, description, link } };
}

/**
 * Whether a link opens a page in the app or another site, or null when it is
 * neither. An internal path may not start with "//" or hold a backslash:
 * browsers read both as another host, which would let an "internal" link
 * leave the app.
 */
export function notificationLinkKind(link: string): "internal" | "external" | null {
  if (link.length > NOTIFICATION_LINK_MAX) {
    return null;
  }
  if (link.startsWith("/")) {
    return /^\/(?![/\\])[^\s\\]*$/.test(link) ? "internal" : null;
  }
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname !== "" && !/\s/.test(link) ? "external" : null;
  } catch {
    return null;
  }
}
