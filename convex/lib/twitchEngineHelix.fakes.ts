import type { TwitchHelixResult } from "@woofx3/api";
import type { EngineApi } from "./engineInstanceUrl";
import { directHelixRoute, type TwitchHelixRoute } from "./twitchEngineHelix";

// Test doubles for code that calls Helix through convex/lib/twitchEngineHelix.ts.
// Kept out of the *.test.ts files so each module's tests share one fake engine.
// The second dot in the file name keeps Convex from deploying it, as it does
// for *.test.ts: Convex skips any file whose name has more than one dot.

export interface EngineCall {
  method: string;
  args: unknown[];
}

/**
 * A route to an engine that answers every Twitch method with `answer` and
 * records what it was asked. `answer` may be a function of the call, for an
 * action that makes several calls.
 */
export function fakeEngineRoute(answer: TwitchHelixResult | ((call: EngineCall) => TwitchHelixResult)): {
  route: TwitchHelixRoute;
  calls: EngineCall[];
} {
  const calls: EngineCall[] = [];
  const engine = new Proxy(
    {},
    {
      get: (_target, method) => {
        if (method === "then") {
          return undefined;
        }
        return async (...args: unknown[]) => {
          const call = { method: String(method), args };
          calls.push(call);
          return typeof answer === "function" ? answer(call) : answer;
        };
      },
    }
  ) as EngineApi;
  return { route: { engine: () => engine, instanceId: "instance-1" }, calls };
}

export const DIRECT_ROUTE: TwitchHelixRoute = directHelixRoute("instance-1");

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Replaces the global fetch with one that answers with `respond` and records
 * each request. Call `restore` when done.
 */
export function stubFetch(respond: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input instanceof Request ? input.url : input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Twitch's error body, compact as Twitch sends it. */
export function helixErrorBody(status: number, message: string): string {
  return JSON.stringify({ error: "Bad Request", status, message });
}

/**
 * The message an async function rejects with, or null when it resolves. For
 * comparing the sentence a Twitch error becomes on either path.
 */
export async function rejection(work: () => Promise<unknown>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    if (error instanceof Error && "data" in error && typeof error.data === "string") {
      return error.data;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
