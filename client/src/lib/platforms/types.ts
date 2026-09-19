// Realtime platform events for dashboard widgets — NOT to be confused with
// engine/module-contributed scene widgets (WidgetDefinition / WidgetInstance
// in the shared @woofx3/api contract), which are a completely separate concept
// rendered as iframes on OBS browser sources.
//
// Events reach the browser from the engine over the transport's capnweb
// session, as CloudEvent frames mapped here by ./engine-events. The browser
// used to hold its own Twitch EventSub socket instead, which meant one
// connection per open tab and a second event vocabulary alongside the
// CloudEvents every other engine surface speaks.
//
// A widget calls `usePlatformEvents` (./use-platform-events) rather than the
// transport directly — the transport keeps a single engine subscription and
// fans out locally, so N widgets asking for the same type still produce one
// registration.

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
