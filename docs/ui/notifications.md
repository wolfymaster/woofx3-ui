# Notifications

The bell in the app header opens the signed-in user's notifications. A dot on the bell means at least one is unread.

## What a notification holds

| Field | Limit |
|---|---|
| Heading | 1–50 characters |
| Description | 1–150 characters |
| Link (optional) | A path in the app (`/admin/engine`) or an `https://` URL, at most 500 characters |
| Action label (optional) | The link's button text, at most 24 characters; only with a link |

An internal link navigates in place and an external link opens a new tab. Without an action label their buttons read **View** and **Open**. Following either marks the notification read. The rules live in `convex/lib/notifications.ts`.

## What a user can do

- Mark one notification read, or all of them.
- Clear one notification, or all of them. Clearing removes it from that user's inbox only.

The menu lists the 30 newest notifications.

## Storage

- `notifications` holds each notification's content once, its audience, and how many inboxes it has reached.
- `userNotifications` holds one row per recipient: the user, the notification and whether it is read. Clearing deletes the row.

Delivery runs in the background in batches of 200 recipients (`notifications.deliverBatch`). The audience is fixed when the notification is created: everyone, the members of one account, or one user. Users who sign up later do not receive an earlier broadcast.

Convex code sends a notification with `sendNotification` in `convex/notifications.ts`.

## Operators

Operators write and retract notifications in the backoffice. The backoffice goes through the ops API (`convex/ops/http.ts`):

| Route | Does |
|---|---|
| `GET /api/ops/notifications?cursor=` | Lists notifications, newest first |
| `POST /api/ops/notifications` | Creates one: `{ requestId, heading, description, link, actionLabel, audience }` |
| `POST /api/ops/notifications/<id>/delete` | Retracts one from every inbox |

Both writes need a reason and are recorded in `opsAuditLog`. Repeating a `requestId` returns the notification it already created.
