import { atom } from "nanostores";

/**
 * True while the transport holds an engine session that has completed an
 * authenticated round trip. Written only by the active WoofxTransport; the
 * status bar reads it instead of asking Convex to probe the engine.
 */
export const $engineConnected = atom<boolean>(false);
