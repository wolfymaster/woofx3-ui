/** A clip made from the live stream. It stays a draft until trimmed and published at `editUrl`. */
export interface CreatedClip {
  clipId: string;
  editUrl: string;
}

/**
 * The clip a Create Clip answer holds. Twitch answers 404 when the channel
 * isn't live and 403 when clipping is disabled for the channel: both are
 * ordinary states worth naming rather than surfacing as a raw status code.
 */
export async function readCreatedClipAnswer(response: Response): Promise<CreatedClip> {
  if (response.status === 404) {
    throw new Error("Twitch has nothing to clip — the channel has to be live.");
  }
  if (response.status === 403) {
    throw new Error("Twitch refused the clip. Clipping may be disabled for this channel.");
  }
  if (!response.ok) {
    throw new Error(`Twitch clip creation failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { data: Array<{ id: string; edit_url: string }> };
  const clip = data.data[0];
  if (!clip) {
    throw new Error("Twitch accepted the request but returned no clip");
  }
  return { clipId: clip.id, editUrl: clip.edit_url };
}
