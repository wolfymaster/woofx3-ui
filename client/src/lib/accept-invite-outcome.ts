import type { AcceptOutcome } from "@convex/invitations";

/** What the accept page tells someone whose invite link did not join them to an engine. */
export const ACCEPT_REFUSAL_MESSAGES: Record<
  Exclude<AcceptOutcome["status"], "accepted" | "already_member" | "wrong_account">,
  string
> = {
  already_accepted:
    "This invitation has already been used. If it was you, sign in with the account you used to accept it. Otherwise ask for a new invitation.",
  expired: "This invitation has expired. Ask the person who invited you to send a new one.",
  revoked: "This invitation was cancelled. Ask the person who invited you to send a new one.",
  not_found: "We could not find this invitation. Check that you opened the full link from your invite.",
  engine_gone:
    "The engine this invitation was for has been deleted. Ask the person who invited you for a new invitation.",
  seats_full:
    "This organization has no free seats right now. Ask the person who invited you to free one up or upgrade their plan, then open this link again.",
  not_in_organization:
    "This invitation can't add you to the organization. Ask the organization's owner or an admin to invite you.",
  org_suspended:
    "This organization's subscription isn't active, so it can't take new people right now. Ask the organization's owner to reactivate it, then open this link again.",
};

/** The message for a refused outcome, or null when the outcome puts the user on the engine. */
export function acceptRefusalMessage(outcome: AcceptOutcome): string | null {
  if (outcome.status === "accepted" || outcome.status === "already_member") {
    return null;
  }
  if (outcome.status === "wrong_account") {
    return outcome.message;
  }
  return ACCEPT_REFUSAL_MESSAGES[outcome.status];
}
