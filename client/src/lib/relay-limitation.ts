import { atom } from "nanostores";

/**
 * Why a cloud engine can't reach this computer although the dashboard can
 * reach the engine. The relay only exists in the desktop app, so the web build
 * never sets this and its status bar never reads as limited.
 */
export interface RelayLimitation {
  /** One line for the streamer, on what is wrong and what it affects. */
  detail: string;
  /** Null when connecting again is out of the streamer's hands. */
  reconnect: (() => Promise<void>) | null;
}

export const $relayLimitation = atom<RelayLimitation | null>(null);
