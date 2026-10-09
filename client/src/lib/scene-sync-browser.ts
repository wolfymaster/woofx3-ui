import type { ConnectSocket, SyncClock } from "@woofx3/api/scene-editor/client";
import { PROTOCOL_VERSION } from "@woofx3/api/scene-editor/protocol";

/**
 * The browser's side of `SceneSyncClient`'s injected pieces: the socket, the
 * clock, and the editor socket's URL.
 */

/** What `sceneActions.getSceneEditorSession` returns that the URL needs. */
export interface EditorSessionGrant {
  /** Presented once, as `?token=`. */
  token: string;
  /** The editor socket, relative to sceneManager's public URL. */
  path: string;
}

/**
 * sceneManager's editor socket for `grant`. The socket is served from the
 * origin the scene's preview overlay comes from (`previewUrl`), which is
 * sceneManager's public URL; the engine answers a socket without
 * `protocol=2` with HTTP 426.
 */
export function editorSocketUrl(grant: EditorSessionGrant, previewUrl: string): string {
  const url = new URL(grant.path, new URL(previewUrl).origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", grant.token);
  url.searchParams.set("protocol", String(PROTOCOL_VERSION));
  return url.toString();
}

export const connectBrowserSocket: ConnectSocket = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.onopen = () => handlers.onOpen();
  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data === "string") {
      handlers.onMessage(event.data);
    }
  };
  socket.onclose = (event: CloseEvent) => handlers.onClose(event.code, event.reason);
  return {
    send(text) {
      // The client sends only once the socket has opened; one closing under
      // it reports the close through `onclose`, which the client acts on.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(text);
      }
    },
    close(code, reason) {
      socket.close(code, reason);
    },
  };
};

export const browserClock: SyncClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};
