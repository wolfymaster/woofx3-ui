// Direct-to-platform realtime events for dashboard widgets — NOT to be
// confused with engine/module-contributed scene widgets (WidgetDefinition /
// WidgetInstance in the shared @woofx3/api contract), which are a completely
// separate concept rendered as iframes on OBS browser sources. This is
// UI-native: the browser connects straight to the streaming platform (e.g.
// Twitch EventSub) so dashboard widgets get realtime events without any
// engine round-trip.
//
// A widget calls `usePlatformEvents` (./use-platform-events) rather than
// touching a PlatformClient directly — that hook is what turns N widgets
// each asking for the same event type into a single real subscription per
// type, shared across every connected platform.

export type PlatformEventType = "follow" | "subscribe" | "cheer" | "raid";

export type PlatformId = "twitch";

export interface PlatformEvent {
  id: string;
  platform: PlatformId;
  type: PlatformEventType;
  userName: string;
  amount?: number;
  message?: string;
  tier?: string;
  timestamp: Date;
}

export interface PlatformClient {
  isConnected(): boolean;
  /** Ref-counted: the underlying subscription is created on the first call for
   * a given type and torn down when the last one unsubscribes. */
  subscribe(eventType: PlatformEventType, callback: (event: PlatformEvent) => void): () => void;
  disconnect(): void;
}
