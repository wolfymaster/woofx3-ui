import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName } from "convex/server";
import { NoInstanceSelectedError } from "@/engine/scope";
import type { PinHistoryEntryId, ShoutoutEntryId, StreamInfoPresetId } from "@/engine/types";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: a gateway
// request or read must send what the Twitch widgets, the command palette and
// the go-live checklist sent before, and answer with the gateway's own
// records.

type FunctionRef = Parameters<typeof getFunctionName>[0];

const calls: Array<{ name: string; args: unknown }> = [];
const queries: Array<{ name: string; args: unknown }> = [];
const optimistic: Array<{ name: string; update: unknown }> = [];
let results: Record<string, unknown> = {};

const SCHEDULE = {
  nextAdAt: null,
  lastAdAt: null,
  durationSeconds: 90,
  prerollFreeSeconds: 0,
  snoozeCount: 3,
  snoozeRefreshAt: null,
  serverNow: "2026-10-21T12:00:00.000Z",
};
const MODERATED = { login: "ninja", displayName: "Ninja" };
const CHAT_SETTINGS = {
  emoteMode: false,
  followerMode: false,
  followerModeDuration: null,
  slowMode: true,
  slowModeWaitTime: 30,
  subscriberMode: false,
};

/** What each Convex function answers unless a test says otherwise. */
const ANSWERS: Record<string, unknown> = {
  "adBreaks:getSchedule": SCHEDULE,
  "adBreaks:snoozeNextAd": { snoozeCount: 2, snoozeRefreshAt: null, nextAdAt: null, serverNow: SCHEDULE.serverNow },
  "moderation:listBlockedTerms": { terms: [], truncated: false },
  "moderation:addBlockedTerm": { id: "term-1", text: "spam", createdAt: null, expiresAt: null },
  "moderation:timeoutUser": MODERATED,
  "moderation:banUser": MODERATED,
  "moderation:unbanUser": MODERATED,
  "moderation:getChatSettings": CHAT_SETTINGS,
  "moderation:updateChatSettings": CHAT_SETTINGS,
  "pins:pinNewMessage": { messageId: "m-1" },
  "pins:repinFromHistory": { messageId: "m-2", resent: false },
  "shoutouts:listChatters": [],
  "streamInfo:searchCategories": [],
  "streamInfo:updateChannelInfo": { info: { title: "new", category: null, tags: [] }, unapplied: [] },
  "streamInfo:createMarker": { positionSeconds: 12, createdAt: null },
  "streamInfo:savePreset": "preset-1",
  "twitchClips:createClip": { clipId: "clip-1", editUrl: "https://clips.test/edit" },
  "goLive:complete": { announcement: { status: "done" }, marker: { status: "done" } },
};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

function recordingCall(name: string) {
  return (args: unknown) => {
    calls.push({ name, args });
    return Promise.resolve(results[name] ?? null);
  };
}

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: FunctionRef) => recordingCall(getFunctionName(action)),
  useMutation: (mutation: FunctionRef) => {
    const name = getFunctionName(mutation);
    return Object.assign(recordingCall(name), {
      withOptimisticUpdate: (update: unknown) => {
        optimistic.push({ name, update });
        return recordingCall(name);
      },
    });
  },
  useQuery: (query: FunctionRef, args: unknown) => {
    const name = getFunctionName(query);
    queries.push({ name, args });
    return results[name];
  },
}));

const { convexAdBreaksGateway } = await import("./ad-breaks");
const { convexModerationGateway } = await import("./moderation");
const { convexPinsGateway } = await import("./pins");
const { convexShoutoutsGateway, reorderQueueOptimistically } = await import("./shoutouts");
const { convexTwitchChatGateway } = await import("./twitch-chat");
const { convexClipsGateway } = await import("./clips");
const { convexStreamInfoGateway, removePresetOptimistically, toStreamInfo } = await import("./stream-info");
const { convexGoLiveGateway, toGoLiveCompletion, toGoLiveStreamInfoFacts, toGoLiveTwitchFacts } = await import(
  "./go-live"
);

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
  queries.length = 0;
  optimistic.length = 0;
  results = { ...ANSWERS };
});

describe("requests carry the scope's instance", () => {
  const cases: Array<{ name: string; run: () => Promise<unknown>; expected: { name: string; args: unknown } }> = [
    {
      name: "ad schedule",
      run: () => renderInScope(() => convexAdBreaksGateway.useScheduleRequest())(),
      expected: { name: "adBreaks:getSchedule", args: { instanceId } },
    },
    {
      name: "snooze",
      run: () => renderInScope(() => convexAdBreaksGateway.useSnoozeRequest())(),
      expected: { name: "adBreaks:snoozeNextAd", args: { instanceId } },
    },
    {
      name: "blocked terms",
      run: () => renderInScope(() => convexModerationGateway.useBlockedTermsRequest())(),
      expected: { name: "moderation:listBlockedTerms", args: { instanceId } },
    },
    {
      name: "add a blocked term",
      run: () => renderInScope(() => convexModerationGateway.useAddBlockedTermRequest())("spam"),
      expected: { name: "moderation:addBlockedTerm", args: { instanceId, text: "spam" } },
    },
    {
      name: "remove a blocked term",
      run: () => renderInScope(() => convexModerationGateway.useRemoveBlockedTermRequest())("term-1"),
      expected: { name: "moderation:removeBlockedTerm", args: { instanceId, termId: "term-1" } },
    },
    {
      name: "time out",
      run: () => renderInScope(() => convexModerationGateway.useTimeoutRequest())("ninja", 600),
      expected: { name: "moderation:timeoutUser", args: { instanceId, login: "ninja", seconds: 600 } },
    },
    {
      name: "ban with a reason",
      run: () => renderInScope(() => convexModerationGateway.useBanRequest())("ninja", "spam"),
      expected: { name: "moderation:banUser", args: { instanceId, login: "ninja", reason: "spam" } },
    },
    {
      name: "unban",
      run: () => renderInScope(() => convexModerationGateway.useUnbanRequest())("ninja"),
      expected: { name: "moderation:unbanUser", args: { instanceId, login: "ninja" } },
    },
    {
      name: "chat settings",
      run: () => renderInScope(() => convexModerationGateway.useChatSettingsRequest())(),
      expected: { name: "moderation:getChatSettings", args: { instanceId } },
    },
    {
      name: "change chat settings",
      run: () => renderInScope(() => convexModerationGateway.useUpdateChatSettingsRequest())({ slowMode: true }),
      expected: { name: "moderation:updateChatSettings", args: { instanceId, patch: { slowMode: true } } },
    },
    {
      name: "current pin",
      run: () => renderInScope(() => convexPinsGateway.useCurrentRequest())(),
      expected: { name: "pins:currentPin", args: { instanceId } },
    },
    {
      name: "pin a new message",
      run: () => renderInScope(() => convexPinsGateway.usePinNewRequest())("hello"),
      expected: { name: "pins:pinNewMessage", args: { instanceId, text: "hello" } },
    },
    {
      name: "repin",
      run: () => renderInScope(() => convexPinsGateway.useRepinRequest())("pin-1" as PinHistoryEntryId),
      expected: { name: "pins:repinFromHistory", args: { instanceId, entryId: "pin-1" } },
    },
    {
      name: "unpin",
      run: () => renderInScope(() => convexPinsGateway.useUnpinRequest())("message-1"),
      expected: { name: "pins:unpinCurrent", args: { instanceId, messageId: "message-1" } },
    },
    {
      name: "remove a history entry",
      run: () => renderInScope(() => convexPinsGateway.useRemoveFromHistoryRequest())("pin-1" as PinHistoryEntryId),
      expected: { name: "pins:removeFromHistory", args: { instanceId, entryId: "pin-1" } },
    },
    {
      name: "look up a channel",
      run: () => renderInScope(() => convexShoutoutsGateway.useLookupRequest())("ninja"),
      expected: { name: "shoutouts:lookupUser", args: { instanceId, login: "ninja" } },
    },
    {
      name: "queue a shoutout",
      run: () =>
        renderInScope(() => convexShoutoutsGateway.useEnqueueRequest())({
          twitchUserId: "42",
          login: "ninja",
          displayName: "Ninja",
          profileImageUrl: "https://example.test/ninja.png",
          broadcasterType: "partner",
        }),
      expected: {
        name: "shoutouts:enqueue",
        args: {
          instanceId,
          twitchUserId: "42",
          login: "ninja",
          displayName: "Ninja",
          profileImageUrl: "https://example.test/ninja.png",
          broadcasterType: "partner",
        },
      },
    },
    {
      name: "remove a queued shoutout",
      run: () => renderInScope(() => convexShoutoutsGateway.useRemoveRequest())("entry-1" as ShoutoutEntryId),
      expected: { name: "shoutouts:removeEntry", args: { instanceId, entryId: "entry-1" } },
    },
    {
      name: "reorder the queue",
      run: () =>
        renderInScope(() => convexShoutoutsGateway.useReorderRequest())([
          "entry-2" as ShoutoutEntryId,
          "entry-1" as ShoutoutEntryId,
        ]),
      expected: { name: "shoutouts:reorderQueue", args: { instanceId, entryIds: ["entry-2", "entry-1"] } },
    },
    {
      name: "chat message",
      run: () => renderInScope(() => convexTwitchChatGateway.useSendMessageRequest())("hi chat"),
      expected: { name: "twitchBroadcast:sendChatMessage", args: { instanceId, message: "hi chat" } },
    },
    {
      name: "announcement",
      run: () =>
        renderInScope(() => convexTwitchChatGateway.useSendAnnouncementRequest())({ message: "hi", color: "primary" }),
      expected: { name: "twitchBroadcast:sendAnnouncement", args: { instanceId, message: "hi", color: "primary" } },
    },
    {
      name: "immediate shoutout",
      run: () => renderInScope(() => convexTwitchChatGateway.useSendShoutoutRequest())("ninja"),
      expected: { name: "twitchBroadcast:sendShoutout", args: { instanceId, targetLogin: "ninja" } },
    },
    {
      name: "clip",
      run: () => renderInScope(() => convexClipsGateway.useCreateRequest())(),
      expected: { name: "twitchClips:createClip", args: { instanceId } },
    },
    {
      name: "category search",
      run: () => renderInScope(() => convexStreamInfoGateway.useSearchCategoriesRequest())("just chatting"),
      expected: { name: "streamInfo:searchCategories", args: { instanceId, query: "just chatting" } },
    },
    {
      name: "title change",
      run: () => renderInScope(() => convexStreamInfoGateway.useUpdateRequest())({ title: "new" }),
      expected: { name: "streamInfo:updateChannelInfo", args: { instanceId, title: "new" } },
    },
    {
      name: "marker",
      run: () => renderInScope(() => convexStreamInfoGateway.useCreateMarkerRequest())("highlight"),
      expected: { name: "streamInfo:createMarker", args: { instanceId, description: "highlight" } },
    },
    {
      name: "save a preset",
      run: () =>
        renderInScope(() => convexStreamInfoGateway.useSavePresetRequest())({
          name: "Chill",
          info: { title: "Cozy", category: { id: "509658", name: "Just Chatting" }, tags: ["cozy"] },
        }),
      expected: {
        name: "streamInfo:savePreset",
        args: {
          instanceId,
          name: "Chill",
          title: "Cozy",
          category: { id: "509658", name: "Just Chatting" },
          tags: ["cozy"],
        },
      },
    },
    {
      name: "remove a preset",
      run: () =>
        renderInScope(() => convexStreamInfoGateway.useRemovePresetRequest())("preset-1" as StreamInfoPresetId),
      expected: { name: "streamInfo:removePreset", args: { instanceId, presetId: "preset-1" } },
    },
    {
      name: "dismiss a check",
      run: () => renderInScope(() => convexGoLiveGateway.useSetCheckDismissedRequest())("obs", true),
      expected: { name: "goLive:setCheckDismissed", args: { instanceId, checkId: "obs", dismissed: true } },
    },
    {
      name: "finish the checklist",
      run: () => {
        results["goLive:complete"] = { announcement: { status: "done" }, marker: { status: "done" } };
        return renderInScope(() => convexGoLiveGateway.useCompleteRequest())({
          announcement: "live!",
          dropMarker: true,
        });
      },
      expected: { name: "goLive:complete", args: { instanceId, announcement: "live!", dropMarker: true } },
    },
  ];

  for (const { name, run, expected } of cases) {
    test(name, async () => {
      await run();
      expect(calls).toEqual([expected]);
    });
  }

  test("a request made with no instance selected rejects without calling Convex", async () => {
    const snooze = renderInScope(() => convexAdBreaksGateway.useSnoozeRequest(), null);
    await expect(snooze()).rejects.toBeInstanceOf(NoInstanceSelectedError);
    expect(calls).toEqual([]);
  });

  test("the queue reorder and the preset removal show their result before Convex answers", () => {
    renderInScope(() => convexShoutoutsGateway.useReorderRequest());
    renderInScope(() => convexStreamInfoGateway.useRemovePresetRequest());
    expect(optimistic).toHaveLength(2);
    expect(optimistic[0]?.name).toBe("shoutouts:reorderQueue");
    expect(optimistic[0]?.update).toBe(reorderQueueOptimistically);
    expect(optimistic[1]?.name).toBe("streamInfo:removePreset");
    expect(optimistic[1]?.update).toBe(removePresetOptimistically);
  });
});

describe("requests answer with the gateway's records", () => {
  test("a Convex refusal arrives as a plain Error with its sentence", async () => {
    const { ConvexError } = await import("convex/values");
    results["adBreaks:getSchedule"] = Promise.reject(new ConvexError("Reconnect Twitch to read ads"));
    const read = renderInScope(() => convexAdBreaksGateway.useScheduleRequest());
    const failure = await read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ConvexError);
    expect((failure as Error).message).toBe("Reconnect Twitch to read ads");
  });

  test("no pin reads as null, and a pin keeps its timing", async () => {
    const current = renderInScope(() => convexPinsGateway.useCurrentRequest());
    expect(await current()).toBeNull();
    results["pins:currentPin"] = { messageId: "m-1", content: "hello", authorName: "wolfy", expiresAt: "2026-10-21" };
    expect(await current()).toEqual({
      messageId: "m-1",
      content: "hello",
      authorName: "wolfy",
      expiresAt: "2026-10-21",
    });
  });

  test("an unknown login reads as null", async () => {
    const lookup = renderInScope(() => convexShoutoutsGateway.useLookupRequest());
    expect(await lookup("nobody")).toBeNull();
  });

  test("a preset save answers with the preset's id", async () => {
    results["streamInfo:savePreset"] = "preset-9";
    const save = renderInScope(() => convexStreamInfoGateway.useSavePresetRequest());
    expect(await save({ name: "Chill", info: { title: "Cozy", category: null, tags: [] } })).toBe(
      "preset-9" as StreamInfoPresetId
    );
  });

  test("chatters cross field by field", async () => {
    results["shoutouts:listChatters"] = [{ userId: "1", login: "ninja", displayName: "Ninja", extra: true }];
    const chatters = renderInScope(() => convexTwitchChatGateway.useChattersRequest());
    expect(await chatters()).toEqual([{ userId: "1", login: "ninja", displayName: "Ninja" }]);
  });
});

describe("reads", () => {
  const reads: Array<{ name: string; read: (enabled: boolean) => unknown; query: string }> = [
    {
      name: "moderation access",
      read: (enabled) => convexModerationGateway.useAccess({ enabled }),
      query: "moderation:access",
    },
    { name: "pin history", read: (enabled) => convexPinsGateway.useHistory({ enabled }), query: "pins:listHistory" },
    {
      name: "shoutout queue",
      read: (enabled) => convexShoutoutsGateway.useQueue({ enabled }),
      query: "shoutouts:listQueue",
    },
    {
      name: "presets",
      read: (enabled) => convexStreamInfoGateway.usePresets({ enabled }),
      query: "streamInfo:listPresets",
    },
    {
      name: "go-live checklist",
      read: (enabled) => convexGoLiveGateway.useChecklist({ enabled }),
      query: "goLive:checklist",
    },
    {
      name: "go-live overlays",
      read: (enabled) => convexGoLiveGateway.useOverlays({ enabled }),
      query: "goLive:overlays",
    },
  ];

  for (const { name, read, query } of reads) {
    test(`${name} asks for the scope's instance, and skips when disabled or with no instance`, () => {
      renderInScope(() => read(true));
      renderInScope(() => read(false));
      renderInScope(() => read(true), null);
      expect(queries).toEqual([
        { name: query, args: { instanceId } },
        { name: query, args: "skip" },
        { name: query, args: "skip" },
      ]);
    });
  }

  test("a history entry crosses with the gateway's id, and a field Convex left out reads as null", () => {
    results["pins:listHistory"] = [
      { id: "pin-1", content: "hi", twitchMessageId: "m-1", createdAt: 1, lastPinnedAt: 2, extra: true },
    ];
    expect(renderInScope(() => convexPinsGateway.useHistory())).toStrictEqual([
      {
        id: "pin-1" as PinHistoryEntryId,
        content: "hi",
        authorName: null,
        twitchMessageId: "m-1",
        createdAt: 1,
        lastPinnedAt: 2,
      },
    ]);
  });
});

/** A local store holding one query result, for the optimistic updates. */
function storeWith(name: string, value: unknown): { store: OptimisticLocalStore; written: () => unknown } {
  let current = value;
  let wrote = false;
  const store = {
    getQuery: (query: FunctionRef) => (getFunctionName(query) === name ? current : undefined),
    setQuery: (query: FunctionRef, _args: unknown, next: unknown) => {
      if (getFunctionName(query) === name) {
        current = next;
        wrote = true;
      }
    },
    getAllQueries: () => [],
  } as unknown as OptimisticLocalStore;
  return { store, written: () => (wrote ? current : "unwritten") };
}

describe("optimistic updates", () => {
  test("a reorder puts the queue in the new order and leaves out entries gone meanwhile", () => {
    const { store, written } = storeWith("shoutouts:listQueue", [{ id: "a" }, { id: "b" }, { id: "c" }]);
    reorderQueueOptimistically(store, {
      instanceId: instanceId as string as Parameters<typeof reorderQueueOptimistically>[1]["instanceId"],
      entryIds: ["c", "gone", "a"] as Parameters<typeof reorderQueueOptimistically>[1]["entryIds"],
    });
    expect(written()).toEqual([{ id: "c" }, { id: "a" }]);
  });

  test("a reorder before the queue has loaded writes nothing", () => {
    const { store, written } = storeWith("shoutouts:listQueue", undefined);
    reorderQueueOptimistically(store, {
      instanceId: instanceId as string as Parameters<typeof reorderQueueOptimistically>[1]["instanceId"],
      entryIds: [],
    });
    expect(written()).toBe("unwritten");
  });

  test("a removed preset leaves the list at once", () => {
    const { store, written } = storeWith("streamInfo:listPresets", [{ id: "p-1" }, { id: "p-2" }]);
    removePresetOptimistically(store, {
      instanceId: instanceId as string as Parameters<typeof removePresetOptimistically>[1]["instanceId"],
      presetId: "p-1" as Parameters<typeof removePresetOptimistically>[1]["presetId"],
    });
    expect(written()).toEqual([{ id: "p-2" }]);
  });
});

describe("mappers", () => {
  type TwitchFacts = Parameters<typeof toGoLiveTwitchFacts>[0];
  type StreamInfoFacts = Parameters<typeof toGoLiveStreamInfoFacts>[0];
  type Completion = Parameters<typeof toGoLiveCompletion>[0];
  type StreamInfoRow = Parameters<typeof toStreamInfo>[0];

  const cases: Array<{ name: string; map: () => unknown; expected: unknown }> = [
    {
      name: "an unlinked Twitch check carries nothing else",
      map: () => toGoLiveTwitchFacts({ linked: false, login: "stray" } as unknown as TwitchFacts),
      expected: { linked: false },
    },
    {
      name: "a linked Twitch check keeps its token state and missing scopes",
      map: () =>
        toGoLiveTwitchFacts({
          linked: true,
          login: "wolfy",
          tokenValid: false,
          tokenProblem: "Twitch no longer accepts the connection",
          missingScopes: ["user:write:chat"],
        }),
      expected: {
        linked: true,
        login: "wolfy",
        tokenValid: false,
        tokenProblem: "Twitch no longer accepts the connection",
        missingScopes: ["user:write:chat"],
      },
    },
    {
      name: "an unlinked stream info check carries nothing else",
      map: () => toGoLiveStreamInfoFacts({ kind: "unlinked", title: "stray" } as unknown as StreamInfoFacts),
      expected: { kind: "unlinked" },
    },
    {
      name: "a stream info check keeps the channel",
      map: () =>
        toGoLiveStreamInfoFacts({
          kind: "ok",
          login: "wolfy",
          title: "Cozy",
          categoryId: "509658",
          categoryName: "Just Chatting",
          tags: ["cozy"],
        }),
      expected: {
        kind: "ok",
        login: "wolfy",
        title: "Cozy",
        categoryId: "509658",
        categoryName: "Just Chatting",
        tags: ["cozy"],
      },
    },
    {
      name: "each finishing step keeps its own outcome",
      map: () =>
        toGoLiveCompletion({
          announcement: { status: "failed", message: "AutoMod held it" },
          marker: { status: "queued", reason: "When the stream goes live" },
        } as Completion),
      expected: {
        announcement: { status: "failed", message: "AutoMod held it" },
        marker: { status: "queued", reason: "When the stream goes live" },
      },
    },
    {
      name: "a skipped step keeps its reason",
      map: () =>
        toGoLiveCompletion({
          announcement: { status: "skipped", reason: "No announcement was asked for" },
          marker: { status: "done" },
        } as Completion),
      expected: {
        announcement: { status: "skipped", reason: "No announcement was asked for" },
        marker: { status: "done" },
      },
    },
    {
      name: "a channel with no category keeps null",
      map: () => toStreamInfo({ title: "Cozy", category: null, tags: [] }),
      expected: { title: "Cozy", category: null, tags: [] },
    },
    {
      name: "a category crosses without fields the gateway does not name",
      map: () =>
        toStreamInfo({
          title: "Cozy",
          category: { id: "1", name: "Art", boxArtUrl: "https://art.test/1.jpg", extra: true },
          tags: ["art"],
        } as unknown as StreamInfoRow),
      expected: {
        title: "Cozy",
        category: { id: "1", name: "Art", boxArtUrl: "https://art.test/1.jpg" },
        tags: ["art"],
      },
    },
  ];

  for (const { name, map, expected } of cases) {
    test(name, () => {
      expect(map()).toEqual(expected);
    });
  }
});

describe("stream categories", () => {
  test("a category without art reads as null art, and goes back to Convex with none", async () => {
    results["streamInfo:searchCategories"] = [{ id: "1", name: "Art" }];
    const search = renderInScope(() => convexStreamInfoGateway.useSearchCategoriesRequest());
    const [category] = await search("art");
    expect(category).toStrictEqual({ id: "1", name: "Art", boxArtUrl: null });
    if (!category) {
      throw new Error("expected a category");
    }

    calls.length = 0;
    await renderInScope(() => convexStreamInfoGateway.useUpdateRequest())({ category });
    await renderInScope(() => convexStreamInfoGateway.useSavePresetRequest())({
      name: "Art",
      info: { title: "Drawing", category, tags: [] },
    });
    expect(calls).toStrictEqual([
      {
        name: "streamInfo:updateChannelInfo",
        args: { instanceId, title: undefined, category: { id: "1", name: "Art" }, tags: undefined },
      },
      {
        name: "streamInfo:savePreset",
        args: { instanceId, name: "Art", title: "Drawing", category: { id: "1", name: "Art" }, tags: [] },
      },
    ]);
  });

  test("clearing the category sends null, and leaving it out sends nothing", async () => {
    const update = renderInScope(() => convexStreamInfoGateway.useUpdateRequest());
    await update({ category: null });
    await update({ title: "Cozy" });
    expect(calls.map((call) => (call.args as { category?: unknown }).category)).toStrictEqual([null, undefined]);
  });
});
