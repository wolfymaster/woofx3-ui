import { WebSocket as WsWebSocket } from "ws";

export function createBrowserWebSocketAdapter(ws: WsWebSocket): WebSocket {
  const listeners = new Map<string, Set<EventListener>>();

  const adapter = {
    get readyState() {
      return ws.readyState;
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    get protocol() {
      return ws.protocol;
    },
    get extensions() {
      return ws.extensions;
    },
    get binaryType() {
      return ws.binaryType as BinaryType;
    },
    set binaryType(value: BinaryType) {
      if (value === "arraybuffer") {
        ws.binaryType = "arraybuffer";
      } else if (value === "blob") {
        ws.binaryType = "arraybuffer";
      }
    },
    get url() {
      return ws.url || "";
    },

    CONNECTING: 0 as const,
    OPEN: 1 as const,
    CLOSING: 2 as const,
    CLOSED: 3 as const,

    onopen: null as ((ev: Event) => any) | null,
    onclose: null as ((ev: CloseEvent) => any) | null,
    onerror: null as ((ev: Event) => any) | null,
    onmessage: null as ((ev: MessageEvent) => any) | null,

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      ws.send(data as any);
    },

    close(code?: number, reason?: string): void {
      ws.close(code, reason);
    },

    addEventListener(
      type: string,
      listener: EventListener | EventListenerObject | null,
      _options?: boolean | AddEventListenerOptions
    ): void {
      if (!listener) return;
      const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(fn);
    },

    removeEventListener(
      type: string,
      listener: EventListener | EventListenerObject | null,
      _options?: boolean | EventListenerOptions
    ): void {
      if (!listener) return;
      const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
      listeners.get(type)?.delete(fn);
    },

    dispatchEvent(event: Event): boolean {
      const eventListeners = listeners.get(event.type);
      if (eventListeners) {
        eventListeners.forEach((listener) => {
          try {
            listener(event);
          } catch (e) {
            console.error("Error in event listener:", e);
          }
        });
      }
      const handler = (adapter as any)[`on${event.type}`];
      if (handler) {
        try {
          handler(event);
        } catch (e) {
          console.error("Error in event handler:", e);
        }
      }
      return true;
    },
  };

  ws.on("open", () => {
    const event = new Event("open");
    adapter.dispatchEvent(event);
  });

  ws.on("close", (code, reason) => {
    const event = new CloseEvent("close", {
      code,
      reason: reason.toString(),
      wasClean: code === 1000,
    });
    adapter.dispatchEvent(event);
  });

  ws.on("error", (error) => {
    const event = new ErrorEvent("error", { error, message: error.message });
    adapter.dispatchEvent(event);
  });

  ws.on("message", (data, isBinary) => {
    let messageData: string | ArrayBuffer;
    if (Buffer.isBuffer(data)) {
      messageData = isBinary ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.toString();
    } else if (data instanceof ArrayBuffer) {
      messageData = data;
    } else if (Array.isArray(data)) {
      const buffer = Buffer.concat(data);
      messageData = isBinary ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer.toString();
    } else {
      messageData = String(data);
    }

    const event = new MessageEvent("message", { data: messageData });
    adapter.dispatchEvent(event);
  });

  return adapter as unknown as WebSocket;
}
