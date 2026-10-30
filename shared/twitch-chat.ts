// Writing in the broadcaster's chat as the broadcaster, and reading who is in
// it: the scopes each call needs, what Twitch refuses before a call is spent,
// and how each Helix answer reads. Twitch answers 200 and still drops a
// message (AutoMod, a duplicate, a blocked term), so a send's success is read
// from its body, not its status.

export const SEND_MESSAGE_SCOPE = "user:write:chat";
export const ANNOUNCEMENT_SCOPE = "moderator:manage:announcements";
export const SHOUTOUT_SCOPE = "moderator:manage:shoutouts";
export const CHATTERS_SCOPE = "moderator:read:chatters";

/** Twitch rejects a chat message or announcement longer than this, so refuse before spending a call. */
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const MAX_ANNOUNCEMENT_LENGTH = 500;
/** Get Chatters' largest page; one page is all a dashboard reads. */
export const CHATTERS_PAGE_SIZE = 1000;

/** Why a trimmed chat message cannot be sent, or null. */
export function chatMessageProblem(message: string): string | null {
  if (!message) {
    return "A chat message needs some text";
  }
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    return `Twitch chat messages are limited to ${MAX_CHAT_MESSAGE_LENGTH} characters`;
  }
  return null;
}

/** Why a trimmed announcement cannot be sent, or null. */
export function announcementProblem(message: string): string | null {
  if (!message) {
    return "An announcement needs a message";
  }
  if (message.length > MAX_ANNOUNCEMENT_LENGTH) {
    return `Twitch announcements are limited to ${MAX_ANNOUNCEMENT_LENGTH} characters`;
  }
  return null;
}

export const SHOUTOUT_NEEDS_CHANNEL_MESSAGE = "A shoutout needs a channel name";

export function noShoutoutChannelMessage(login: string): string {
  return `No Twitch channel called "${login}"`;
}

interface HelixSentMessage {
  data?: Array<{ message_id?: string; is_sent?: boolean; drop_reason?: { message?: string } }>;
}

/** The message a 2xx Send Chat Message answer says was sent; throws Twitch's reason when it was dropped. */
async function sentMessage(response: Response): Promise<{ message_id?: string }> {
  const body = (await response.json()) as HelixSentMessage;
  const result = body.data?.[0];
  if (!result?.is_sent) {
    throw new Error(result?.drop_reason?.message ?? "Twitch accepted the message but did not send it");
  }
  return result;
}

/** A Send Chat Message answer for a message posted from the dashboard. */
export async function readChatMessageAnswer(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`Twitch chat message failed: ${response.status} ${await response.text()}`);
  }
  await sentMessage(response);
}

/** A Send Chat Message answer for a message something else needs the id of, such as a pin. */
export async function readSentMessageIdAnswer(response: Response): Promise<string> {
  if (!response.ok) {
    throw new Error(`Twitch chat send failed: ${response.status} ${await response.text()}`);
  }
  const result = await sentMessage(response);
  if (!result.message_id) {
    throw new Error("Twitch sent the message but returned no id");
  }
  return result.message_id;
}

export async function readAnnouncementAnswer(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`Twitch announcement failed: ${response.status} ${await response.text()}`);
  }
}

export async function readShoutoutAnswer(response: Response): Promise<void> {
  // Twitch rate-limits shoutouts hard (one per 2 minutes, and not to the same
  // channel within 60 minutes) and refuses when the channel isn't live.
  if (response.status === 429) {
    throw new Error("Twitch is rate-limiting shoutouts — try again in a couple of minutes.");
  }
  if (!response.ok) {
    throw new Error(`Twitch shoutout failed: ${response.status} ${await response.text()}`);
  }
}

export interface Chatter {
  userId: string;
  login: string;
  displayName: string;
}

export async function readChattersAnswer(response: Response): Promise<Chatter[]> {
  if (!response.ok) {
    throw new Error(`Twitch chatters lookup failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    data: Array<{ user_id: string; user_login: string; user_name: string }>;
  };
  return body.data.map((chatter) => ({
    userId: chatter.user_id,
    login: chatter.user_login,
    displayName: chatter.user_name,
  }));
}
