import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES } from "@woofx3/api/capabilities";
import { sha256Hex } from "../oauthHandoff";
import { type EventQueueMovePorts, moveEngineToEventQueue } from "./move";

const URLS = {
  deliveryUrl: "https://deployment.convex.site/api/engine-events/batch",
  eventsUrl: "https://maintenance.example/v1/engine-events",
};
const TOKEN = "events-token";

function recordingPorts(capabilities: string[], failAt?: string): { ports: EventQueueMovePorts; calls: string[] } {
  const calls: string[] = [];
  const step = (name: string) => {
    calls.push(name);
    if (name === failAt) {
      throw new Error(`${name} failed`);
    }
  };
  return {
    calls,
    ports: {
      engineCapabilities: async () => {
        step("engineCapabilities");
        return capabilities;
      },
      putSource: async (source) => {
        step(`putSource ${source.deliveryUrl} ${source.tokenSha256}`);
      },
      recordTokenHash: async (hash) => {
        step(`recordTokenHash ${hash}`);
      },
      setEventsTarget: async (target) => {
        step(`setEventsTarget ${target.url} ${target.token}`);
      },
      recordTargetSet: async () => {
        step("recordTargetSet");
      },
    },
  };
}

describe("moveEngineToEventQueue", () => {
  test("registers the source and records the hash before the engine gets the token", async () => {
    const { ports, calls } = recordingPorts([ENGINE_CAPABILITIES.callbacksEventsTarget]);
    expect(await moveEngineToEventQueue(ports, URLS, TOKEN)).toBe("moved");
    const hash = await sha256Hex(TOKEN);
    expect(calls).toEqual([
      "engineCapabilities",
      `putSource ${URLS.deliveryUrl} ${hash}`,
      `recordTokenHash ${hash}`,
      `setEventsTarget ${URLS.eventsUrl} ${TOKEN}`,
      "recordTargetSet",
    ]);
  });

  test("an engine without the capability is left alone", async () => {
    const { ports, calls } = recordingPorts(["clients.pairing"]);
    expect(await moveEngineToEventQueue(ports, URLS, TOKEN)).toBe("unsupported");
    expect(calls).toEqual(["engineCapabilities"]);
  });

  test("a failed source registration never hands the engine a token", async () => {
    const hash = await sha256Hex(TOKEN);
    const { ports, calls } = recordingPorts(
      [ENGINE_CAPABILITIES.callbacksEventsTarget],
      `putSource ${URLS.deliveryUrl} ${hash}`
    );
    await expect(moveEngineToEventQueue(ports, URLS, TOKEN)).rejects.toThrow(
      `putSource ${URLS.deliveryUrl} ${hash} failed`
    );
    expect(calls.some((call) => call.startsWith("setEventsTarget"))).toBe(false);
  });

  test("a failed switch never records the move, so it runs again", async () => {
    const { ports, calls } = recordingPorts(
      [ENGINE_CAPABILITIES.callbacksEventsTarget],
      `setEventsTarget ${URLS.eventsUrl} ${TOKEN}`
    );
    await expect(moveEngineToEventQueue(ports, URLS, TOKEN)).rejects.toThrow(
      `setEventsTarget ${URLS.eventsUrl} ${TOKEN} failed`
    );
    expect(calls).not.toContain("recordTargetSet");
  });
});
