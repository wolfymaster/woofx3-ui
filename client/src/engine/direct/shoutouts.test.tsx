import { afterEach, describe, expect, test } from "bun:test";
import { missingTwitchScopeMessage } from "@shared/twitch-link-refusal";
import type { TwitchHelixResult } from "@woofx3/api";
import type { ShoutoutEntry } from "@/desktop/host";
import { NoInstanceSelectedError } from "@/engine/scope";
import type { TwitchChannel } from "@/engine/types";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { toShoutoutEntryId } from "./ids";
import { toShoutoutEntry } from "./map/shoutouts";
import { directShoutoutsGateway } from "./shoutouts";
import type { FakeEngineState } from "./testing/DirectFakeApi";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { FakeShoutoutQueueHost } from "./testing/FakeShoutoutQueueHost";

const SHOUTOUT_SCOPE = "moderator:manage:shoutouts";

const harnesses: DirectHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

async function connected() {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  const host = new FakeShoutoutQueueHost();
  return { ...harness, host, gateway: directShoutoutsGateway(harness.runtime, host) };
}

function linkTwitch(state: FakeEngineState, scopes: string[]): void {
  state.twitchLink = {
    linked: true,
    revision: 2,
    userId: "b-1",
    login: "streamer",
    displayName: "Streamer",
    profileImageUrl: null,
    scopes,
    expiresAt: null,
    authFailedAt: null,
  };
}

const ok = (body: unknown): TwitchHelixResult => ({ ok: true, body });

const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error
  );

const friend: TwitchChannel = {
  twitchUserId: "f-1",
  login: "friend",
  displayName: "Friend",
  profileImageUrl: null,
  broadcasterType: "affiliate",
};

describe("toShoutoutEntry", () => {
  const entry: ShoutoutEntry = {
    id: 7,
    twitchUserId: "f-1",
    login: "friend",
    displayName: "Friend",
    profileImageUrl: "https://example.test/f.png",
    broadcasterType: "partner",
    attempts: 2,
    nextEligibleAt: 1_700_000_000_000,
    lastError: "not live",
  };

  const cases: Array<{ name: string; entry: ShoutoutEntry; expected: ReturnType<typeof toShoutoutEntry> }> = [
    {
      name: "a retrying entry keeps its attempts, schedule and error",
      entry,
      expected: {
        id: toShoutoutEntryId(7),
        login: "friend",
        displayName: "Friend",
        profileImageUrl: "https://example.test/f.png",
        broadcasterType: "partner",
        attempts: 2,
        nextEligibleAt: 1_700_000_000_000,
        lastError: "not live",
      },
    },
    {
      name: "an entry with no image, type or error carries nulls",
      entry: { ...entry, profileImageUrl: null, broadcasterType: null, lastError: null, attempts: 0 },
      expected: {
        id: toShoutoutEntryId(7),
        login: "friend",
        displayName: "Friend",
        profileImageUrl: null,
        broadcasterType: null,
        attempts: 0,
        nextEligibleAt: 1_700_000_000_000,
        lastError: null,
      },
    },
  ];
  for (const { name, entry: input, expected } of cases) {
    test(name, () => {
      expect(toShoutoutEntry(input)).toEqual(expected);
    });
  }
});

describe("shoutouts", () => {
  test("the queue loads from the host, follows its changes, and stops listening on unmount", async () => {
    const { host, gateway } = await connected();
    await host.enqueue({ ...friend });
    const read = renderDirect(() => gateway.useQueue());
    const first = await read.until((value) => value?.length === 1, "the queue");
    expect(first?.[0]).toMatchObject({ login: "friend", broadcasterType: "affiliate", attempts: 0 });
    await waitFor(() => host.listeners === 1, "the queue listener");

    await host.enqueue({ ...friend, twitchUserId: "g-1", login: "gamer", displayName: "Gamer" });
    const second = await read.until((value) => value?.length === 2, "the live update");
    expect(second?.map((entry) => entry.login)).toEqual(["friend", "gamer"]);

    read.unmount();
    await waitFor(() => host.listeners === 0, "the listener to stop");
  });

  test("a read that is not enabled listens to nothing", async () => {
    const { host, gateway } = await connected();
    const read = renderDirect(() => gateway.useQueue({ enabled: false }));
    expect(read.current()).toBeUndefined();
    expect(host.listeners).toBe(0);
    read.unmount();
  });

  test("enqueueing hands the host the channel, and the queue shows it", async () => {
    const { host, gateway } = await connected();
    const read = renderDirect(() => gateway.useQueue());
    await read.until((value) => value !== undefined, "the queue");
    await renderDirect(() => gateway.useEnqueueRequest()).current()(friend);
    expect(host.enqueued).toEqual([friend]);
    expect((await read.until((value) => value?.length === 1, "the entry"))?.[0]?.login).toBe("friend");
  });

  test("looking up a login finds the channel through the engine, and null when Twitch knows none", async () => {
    const { state, gateway } = await connected();
    linkTwitch(state, [SHOUTOUT_SCOPE]);
    state.twitchAnswer = (_method, params) =>
      (params as { login: string }).login === "friend"
        ? ok({
            data: [
              {
                id: "f-1",
                login: "friend",
                display_name: "Friend",
                profile_image_url: "https://example.test/f.png",
                broadcaster_type: "affiliate",
              },
            ],
          })
        : ok({ data: [] });
    const lookup = renderDirect(() => gateway.useLookupRequest()).current();
    expect(await lookup("@Friend")).toEqual({
      twitchUserId: "f-1",
      login: "friend",
      displayName: "Friend",
      profileImageUrl: "https://example.test/f.png",
      broadcasterType: "affiliate",
    });
    expect(await lookup("nobody")).toBeNull();
    expect(await lookup("not a login!")).toBeNull();
    expect(state.callsOf("twitchGetUsers")).toEqual([[{ login: "friend" }], [{ login: "nobody" }]]);
  });

  test("a lookup without the shoutout permission says so, before asking Twitch", async () => {
    const { state, gateway } = await connected();
    linkTwitch(state, []);
    const lookup = renderDirect(() => gateway.useLookupRequest()).current();
    expect(String(await failure(lookup("friend")))).toContain(missingTwitchScopeMessage(SHOUTOUT_SCOPE));
    expect(state.callsOf("twitchGetUsers")).toEqual([]);
  });

  test("removing an entry that is gone rejects with the host's words as an Error", async () => {
    const { host, gateway } = await connected();
    await host.enqueue(friend);
    const read = renderDirect(() => gateway.useQueue());
    const entries = await read.until((value) => value?.length === 1, "the entry");
    const remove = renderDirect(() => gateway.useRemoveRequest()).current();
    const id = entries?.[0]?.id;
    if (id === undefined) {
      throw new Error("the entry has no id");
    }

    await remove(id);
    await read.until((value) => value?.length === 0, "the removal");

    const error = await failure(remove(id));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("that shoutout is no longer queued");
  });

  test("reordering shows the new order before the host answers", async () => {
    const { host, gateway } = await connected();
    await host.enqueue(friend);
    await host.enqueue({ ...friend, twitchUserId: "g-1", login: "gamer" });
    const read = renderDirect(() => gateway.useQueue());
    const entries = await read.until((value) => value?.length === 2, "the queue");
    const [a, b] = (entries ?? []).map((entry) => entry.id);
    if (a === undefined || b === undefined) {
      throw new Error("the queue has no entries");
    }

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hostReorder = host.reorder.bind(host);
    host.reorder = async (ids) => {
      await held;
      await hostReorder(ids);
    };

    const reordering = renderDirect(() => gateway.useReorderRequest()).current()([b, a]);
    const shown = await read.until((value) => value?.[0]?.id === b, "the optimistic order");
    expect(shown?.map((entry) => entry.login)).toEqual(["gamer", "friend"]);
    release();
    await reordering;
    expect(host.entries.map((entry) => entry.login)).toEqual(["gamer", "friend"]);
  });

  test("a reorder the host refuses rejects and puts the host's order back", async () => {
    const { host, gateway } = await connected();
    await host.enqueue(friend);
    await host.enqueue({ ...friend, twitchUserId: "g-1", login: "gamer" });
    const read = renderDirect(() => gateway.useQueue());
    const entries = await read.until((value) => value?.length === 2, "the queue");
    const [a, b] = (entries ?? []).map((entry) => entry.id);
    if (a === undefined || b === undefined) {
      throw new Error("the queue has no entries");
    }
    host.failReorder = "the engine is not running";

    const error = await failure(renderDirect(() => gateway.useReorderRequest()).current()([b, a]));
    expect((error as Error).message).toBe("the engine is not running");
    const restored = await read.until((value) => value?.[0]?.id === a, "the host's order");
    expect(restored?.map((entry) => entry.login)).toEqual(["friend", "gamer"]);
  });

  test("requests reject while the scope holds no instance", async () => {
    const { gateway } = await connected();
    const remove = renderDirect(() => gateway.useRemoveRequest(), null).current();
    expect(await failure(remove(toShoutoutEntryId(1)))).toBeInstanceOf(NoInstanceSelectedError);
  });
});
