import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexClient } from "@/lib/convexClient";
import type { PlatformClient, PlatformEvent, PlatformEventType } from "./types";

const EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";
const RECONNECT_DELAY_MS = 3000;

const TWITCH_TYPE_TO_EVENT: Record<string, PlatformEventType> = {
  "channel.follow": "follow",
  "channel.subscribe": "subscribe",
  "channel.cheer": "cheer",
  "channel.raid": "raid",
};

interface TwitchEventSubMessage {
  metadata: { message_type: string };
  payload: {
    session?: { id: string; reconnect_url?: string };
    subscription?: { id: string; type: string };
    event?: Record<string, unknown>;
  };
}

function toPlatformEvent(eventType: PlatformEventType, raw: Record<string, unknown>): PlatformEvent {
  const base = { id: crypto.randomUUID(), platform: "twitch" as const, type: eventType, timestamp: new Date() };
  switch (eventType) {
    case "follow":
      return { ...base, userName: String(raw.user_name ?? "Unknown") };
    case "subscribe":
      return { ...base, userName: String(raw.user_name ?? "Unknown"), tier: raw.tier ? String(raw.tier) : undefined };
    case "cheer":
      return {
        ...base,
        userName: raw.is_anonymous ? "Anonymous" : String(raw.user_name ?? "Unknown"),
        amount: typeof raw.bits === "number" ? raw.bits : undefined,
        message: raw.message ? String(raw.message) : undefined,
      };
    case "raid":
      return {
        ...base,
        userName: String(raw.from_broadcaster_user_name ?? "Unknown"),
        amount: typeof raw.viewers === "number" ? raw.viewers : undefined,
      };
    default:
      return { ...base, userName: "Unknown" };
  }
}

interface SubscriptionEntry {
  listeners: Set<(event: PlatformEvent) => void>;
  twitchSubscriptionId: string | null;
}

// One of these per instance, shared by every widget on the page — see
// getTwitchClient below. Owns a single EventSub WebSocket and ref-counts
// subscriptions per event type so N widgets asking for "follow" only ever
// produce one real Twitch subscription.
export class TwitchEventSubClient implements PlatformClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions = new Map<PlatformEventType, SubscriptionEntry>();

  constructor(private instanceId: Id<"instances">) {}

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.sessionId !== null;
  }

  subscribe(eventType: PlatformEventType, callback: (event: PlatformEvent) => void): () => void {
    let entry = this.subscriptions.get(eventType);
    if (!entry) {
      entry = { listeners: new Set(), twitchSubscriptionId: null };
      this.subscriptions.set(eventType, entry);
    }
    entry.listeners.add(callback);

    if (!this.ws) {
      this.connect();
    } else if (this.sessionId && !entry.twitchSubscriptionId) {
      void this.createTwitchSubscription(eventType);
    }

    return () => {
      const current = this.subscriptions.get(eventType);
      if (!current) {
        return;
      }
      current.listeners.delete(callback);
      if (current.listeners.size === 0) {
        this.subscriptions.delete(eventType);
        if (current.twitchSubscriptionId) {
          void convexClient.action(api.platformRealtime.deleteEventSubSubscription, {
            instanceId: this.instanceId,
            subscriptionId: current.twitchSubscriptionId,
          });
        }
      }
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscriptions.clear();
    this.sessionId = null;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    const ws = new WebSocket(EVENTSUB_WS_URL);
    this.ws = ws;

    ws.onmessage = (event) => {
      this.handleMessage(JSON.parse(event.data as string) as TwitchEventSubMessage);
    };

    ws.onclose = () => {
      this.sessionId = null;
      if (this.ws === ws) {
        this.ws = null;
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.subscriptions.size === 0) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private handleMessage(message: TwitchEventSubMessage): void {
    switch (message.metadata.message_type) {
      case "session_welcome": {
        const sessionId = message.payload.session?.id;
        if (!sessionId) {
          return;
        }
        this.sessionId = sessionId;
        // A fresh session invalidates any subscriptions bound to the old one
        // (this happens both on first connect and on reconnect) — recreate
        // one for every event type that still has listeners.
        this.subscriptions.forEach((entry, eventType) => {
          entry.twitchSubscriptionId = null;
          if (entry.listeners.size > 0) {
            void this.createTwitchSubscription(eventType);
          }
        });
        return;
      }
      case "notification": {
        const twitchType = message.payload.subscription?.type;
        const rawEvent = message.payload.event;
        if (!twitchType || !rawEvent) {
          return;
        }
        const eventType = TWITCH_TYPE_TO_EVENT[twitchType];
        const entry = eventType ? this.subscriptions.get(eventType) : undefined;
        if (!entry) {
          return;
        }
        const platformEvent = toPlatformEvent(eventType, rawEvent);
        entry.listeners.forEach((listener) => {
          listener(platformEvent);
        });
        return;
      }
      case "revocation": {
        const twitchType = message.payload.subscription?.type;
        const eventType = twitchType ? TWITCH_TYPE_TO_EVENT[twitchType] : undefined;
        const entry = eventType ? this.subscriptions.get(eventType) : undefined;
        if (entry) {
          entry.twitchSubscriptionId = null;
        }
        return;
      }
      default:
        // session_keepalive, session_reconnect (handled via the close/reconnect
        // path rather than following reconnect_url — a Phase 1 simplification).
        return;
    }
  }

  private async createTwitchSubscription(eventType: PlatformEventType): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const sessionId = this.sessionId;
    try {
      const { subscriptionId } = await convexClient.action(api.platformRealtime.createEventSubSubscription, {
        instanceId: this.instanceId,
        sessionId,
        eventType,
      });
      const entry = this.subscriptions.get(eventType);
      // Bail if the session rotated (reconnect) or the last listener left
      // while this call was in flight.
      if (entry && this.sessionId === sessionId) {
        entry.twitchSubscriptionId = subscriptionId;
      }
    } catch (err) {
      console.warn(`[TwitchEventSubClient] failed to subscribe to ${eventType}:`, err);
    }
  }
}

const clients = new Map<string, TwitchEventSubClient>();

export function getTwitchClient(instanceId: Id<"instances">): TwitchEventSubClient {
  let client = clients.get(instanceId);
  if (!client) {
    client = new TwitchEventSubClient(instanceId);
    clients.set(instanceId, client);
  }
  return client;
}
