/** What the wait for a new engine says, one at a time, in no particular order. */
export const LOADING_MESSAGES: readonly string[] = [
  "Untangling the headset cable",
  "Telling the chat we'll be right back",
  "Asking the webcam to find your good side",
  "Turning it off and on again, respectfully",
  "Hiding the unread messages from view",
  "Teaching the alert box to make an entrance",
  "Pressing Start Streaming, then checking it twice",
  "Politely waking up the raid train",
  "Saving a seat for your first lurker",
  "Warming up the follow button",
  "Stacking the emotes by height",
  "Polishing the bits until they sparkle",
  "Putting a fresh coat of purple on everything",
  "Checking that the mic isn't muted. It was muted.",
  "Convincing the ring light you're worth it",
  "Practising your surprised face for gifted subs",
  "Finding a good home for the starting soon screen",
  "Moving the mod's coffee away from the keyboard",
  "Giving the backseat gamers somewhere to sit",
  "Dusting off the just-chatting chair",
  "Counting to three in the countdown timer. Again.",
  "Feeding the stream goblins",
  "Measuring the green screen for wrinkles",
  "Loading a suspiciously large number of cat clips",
  "Reminding the cat not to walk across the keyboard",
  "Rehearsing the we're-live announcement in the mirror",
  "Tuning the airhorn to a tasteful volume",
  "Rolling for initiative against the bitrate",
  "Laying out snacks for the long stream",
  "Asking chat what we should name this thing",
];

/**
 * The index of a message to show next, never `previous` so the line always
 * changes. `random` returns a number in [0, 1), like `Math.random`.
 */
export function nextLoadingMessage(count: number, previous: number | null, random: () => number): number {
  if (previous === null) {
    return Math.floor(random() * count);
  }
  // Drawing from one fewer and stepping over `previous` keeps the draw even.
  const drawn = Math.floor(random() * (count - 1));
  return drawn >= previous ? drawn + 1 : drawn;
}
