/** Wording used on more than one screen, kept in one place so it cannot drift. */

export const OWNER_ONLY = "Only the account owner can change this.";

export const TRY_AGAIN = "Couldn't do that. Try again.";

/** Scenes, library alerts and the user page keep edits private until they are published. */
export const DRAFT_COPY = {
  savedNotLive: "Draft saved. Not on stream yet.",
  live: "Live on stream",
  privateUntilPublished: "Your changes stay private until you publish.",
  publish: "Publish to stream",
  discard: "Discard changes",
  discardConfirm: "Go back to what's on stream? Your draft changes are lost.",
} as const;
