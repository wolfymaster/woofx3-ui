import { describe, expect, test } from "bun:test";
import {
  buildStarterCommand,
  buildStarterWorkflow,
  estimatedLength,
  fieldTokenNames,
  findStarterPack,
  hasRequirements,
  missingRequirements,
  requirementsMessage,
  STARTER_ACTION_REFS,
  STARTER_PACKS,
  type StarterCatalog,
  type StarterPack,
  type StarterWorkflowDefinition,
  starterFeaturesFrom,
  starterFieldWarning,
  starterItemFieldIds,
  starterPackDefaults,
  textTokens,
  validateStarterValues,
} from "./starterPacks";

const NO_FEATURES = { delayWait: false };

/** Every Twitch trigger event the packs bind to; the event subjects the Twitch module's manifest declares. */
const TWITCH_EVENTS = [
  "channel.follow",
  "channel.raid",
  "channel.subscribe",
  "channel.resub",
  "channel.subscriptionGift",
  "channel.cheer",
];

/** The inputs each action declares in its manifest schema, as the catalog's configFields carry them. */
const ACTION_INPUTS: Record<string, string[]> = {
  [STARTER_ACTION_REFS.chatReply]: ["message"],
  [STARTER_ACTION_REFS.switchScene]: ["sceneName"],
  [STARTER_ACTION_REFS.shoutout]: ["user", "skipIfRateLimited"],
  [STARTER_ACTION_REFS.clip]: [],
  [STARTER_ACTION_REFS.marker]: ["description"],
};

function configFields(ids: string[]): { id: string; label: string; type: string }[] {
  return ids.map((id) => ({ id, label: id, type: "text" }));
}

/** How the catalog lists an action: engine actions by handler, module actions by the function behind them. */
function catalogEntry(ref: string): StarterCatalog["actions"][number] {
  const [moduleId, , manifestId] = ref.split(":");
  const fields = configFields(ACTION_INPUTS[ref] ?? []);
  if (moduleId === "woofx3") {
    return { canonicalRef: ref, handlerType: manifestId, configFields: fields };
  }
  return {
    canonicalRef: ref,
    handlerType: "function",
    functionCall: manifestId.replace("twitch.", ""),
    configFields: fields,
  };
}

/** Twitch module 0.7.0's shoutout: a channel input and no skipIfRateLimited. */
const SHOUTOUT_0_7_0: StarterCatalog["actions"][number] = {
  ...catalogEntry(STARTER_ACTION_REFS.shoutout),
  configFields: configFields(["user"]),
};

/** A catalog as an up-to-date instance with the Twitch module installed has it. */
const FULL_CATALOG: StarterCatalog = {
  triggers: TWITCH_EVENTS.map((event) => ({
    event,
    canonicalRef: `woofx3_twitch:trigger:${event.replace(".", "_")}`,
  })),
  actions: Object.values(STARTER_ACTION_REFS).map(catalogEntry),
};

/** An engine without the OBS workflow actions, with an up-to-date Twitch module. */
const OLD_ENGINE_CATALOG: StarterCatalog = {
  triggers: FULL_CATALOG.triggers,
  actions: FULL_CATALOG.actions.filter((action) => action.canonicalRef !== STARTER_ACTION_REFS.switchScene),
};

/** A Twitch module from before it had workflow actions: its triggers and its own shoutout only. */
const OLD_TWITCH_MODULE_CATALOG: StarterCatalog = {
  triggers: FULL_CATALOG.triggers,
  actions: [catalogEntry(STARTER_ACTION_REFS.chatReply), catalogEntry(STARTER_ACTION_REFS.shoutout)],
};

const OPERATORS = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "exists",
  "not_exists",
  "regex",
  "between",
]);

/**
 * The structural rules the engine applies when a workflow is saved
 * (api/src/workflow/validate-definition.ts in the engine repo, which this
 * repo cannot import), plus the delay wait's bounds.
 */
function definitionErrors(def: StarterWorkflowDefinition): string[] {
  const errors: string[] = [];
  if (def.name.trim() === "") {
    errors.push("name is empty");
  }
  if (def.trigger.type !== "event" || def.trigger.event === "") {
    errors.push("trigger needs an event");
  }
  for (const condition of def.trigger.conditions) {
    if (!/^\$\{trigger\.data\.[A-Za-z.]+\}$/.test(condition.field)) {
      errors.push(`condition field ${condition.field} is not a trigger.data reference`);
    }
    if (!OPERATORS.has(condition.operator)) {
      errors.push(`unknown operator ${condition.operator}`);
    }
  }
  if (def.tasks.length === 0) {
    errors.push("no tasks");
  }
  const ids = new Set<string>();
  for (const task of def.tasks) {
    if (ids.has(task.id)) {
      errors.push(`duplicate task id ${task.id}`);
    }
    for (const dep of task.dependsOn ?? []) {
      if (!ids.has(dep)) {
        errors.push(`task ${task.id} depends on ${dep}, which does not come before it`);
      }
    }
    ids.add(task.id);
    if (task.type === "action" && !task.action) {
      errors.push(`action task ${task.id} names no action`);
    }
    if (task.type === "wait") {
      const ms = task.wait?.durationMs ?? 0;
      if (task.wait?.type !== "delay" || !Number.isInteger(ms) || ms < 1 || ms > 86_400_000) {
        errors.push(`wait task ${task.id} is not a valid delay`);
      }
    }
  }
  return errors;
}

/** Strings in a built definition that still carry an unfilled `{name}` placeholder or a field reference. */
function leftovers(value: unknown): string[] {
  if (typeof value === "string") {
    return textTokens(value).map((name) => `{${name}}`);
  }
  if (Array.isArray(value)) {
    return value.flatMap(leftovers);
  }
  if (value && typeof value === "object") {
    if ("field" in value && Object.keys(value).length === 1) {
      return [JSON.stringify(value)];
    }
    return Object.values(value).flatMap(leftovers);
  }
  return [];
}

function pack(id: string): StarterPack {
  const found = findStarterPack(id);
  if (!found) {
    throw new Error(`no pack ${id}`);
  }
  return found;
}

describe("starter pack data", () => {
  test("pack ids are unique, and item, field and step ids are unique within their pack", () => {
    const packIds = STARTER_PACKS.map((p) => p.id);
    expect(new Set(packIds).size).toBe(packIds.length);
    for (const p of STARTER_PACKS) {
      const itemIds = p.items.map((item) => item.id);
      expect(new Set(itemIds).size).toBe(itemIds.length);
      const fieldIds = p.fields.map((field) => field.id);
      expect(new Set(fieldIds).size).toBe(fieldIds.length);
      for (const item of p.items) {
        const stepIds = item.steps.map((step) => step.id);
        expect(new Set(stepIds).size).toBe(stepIds.length);
      }
    }
  });

  test("command names are unique across packs", () => {
    const names = STARTER_PACKS.flatMap((p) =>
      p.items.flatMap((item) => (item.kind === "command" ? [item.command] : []))
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  test("every field is read by an item, and every field an item reads is declared", () => {
    for (const p of STARTER_PACKS) {
      const declared = new Set(p.fields.map((field) => field.id));
      const read = new Set(p.items.flatMap(starterItemFieldIds));
      expect([...read].filter((id) => !declared.has(id))).toEqual([]);
      expect([...declared].filter((id) => !read.has(id))).toEqual([]);
    }
  });

  test("every default value passes the pack's own validation", () => {
    for (const p of STARTER_PACKS) {
      const result = validateStarterValues(p, {}, NO_FEATURES);
      expect(result).toEqual({ ok: true, values: starterPackDefaults(p) });
    }
  });

  test("every item builds, with defaults, into a definition the engine accepts and no placeholder left", () => {
    for (const p of STARTER_PACKS) {
      const values = starterPackDefaults(p);
      for (const item of p.items) {
        if (item.kind === "workflow") {
          const def = buildStarterWorkflow(item, values, FULL_CATALOG);
          expect({ item: item.id, errors: definitionErrors(def) }).toEqual({ item: item.id, errors: [] });
          expect({ item: item.id, leftovers: leftovers(def) }).toEqual({ item: item.id, leftovers: [] });
        } else {
          const command = buildStarterCommand(item, values, FULL_CATALOG);
          expect(command.actions.length).toBeGreaterThan(0);
          expect({ item: item.id, leftovers: leftovers(command) }).toEqual({ item: item.id, leftovers: [] });
        }
      }
    }
  });
});

describe("buildStarterWorkflow", () => {
  const raid = pack("raid-welcome");
  const raidItem = raid.items[0];
  if (raidItem.kind !== "workflow") {
    throw new Error("raid welcome is a workflow");
  }

  test("chains the raid steps and fills the raider's name and id from the event", () => {
    const values = { ...starterPackDefaults(raid), shoutoutDelaySeconds: 5 };
    const def = buildStarterWorkflow(raidItem, values, FULL_CATALOG);
    expect(def.trigger).toEqual({
      type: "event",
      event: "channel.raid",
      conditions: [],
      $ref: "woofx3_twitch:trigger:channel_raid",
    });
    expect(def.tasks.map((task) => [task.id, task.dependsOn])).toEqual([
      ["thank-raider", undefined],
      ["let-raiders-arrive", ["thank-raider"]],
      ["shout-out-raider", ["let-raiders-arrive"]],
      ["mark-raid", ["shout-out-raider"]],
    ]);
    expect(def.tasks[0]).toMatchObject({
      type: "action",
      action: "chat.reply",
      $ref: STARTER_ACTION_REFS.chatReply,
      parameters: {
        message:
          "${trigger.data.fromBroadcasterUserName} is raiding with ${trigger.data.viewers} viewers! Welcome in, everyone!",
      },
    });
    expect(def.tasks[1].wait).toEqual({ type: "delay", durationMs: 5000 });
    expect(def.tasks[2]).toMatchObject({
      action: "function",
      function: "shoutout",
      $ref: STARTER_ACTION_REFS.shoutout,
    });
    expect(def.tasks[2].parameters).toEqual({
      user: "${trigger.data.fromBroadcasterUserId}",
      skipIfRateLimited: true,
    });
    expect(def.tasks[3].parameters).toEqual({ description: "Raid from ${trigger.data.fromBroadcasterUserName}" });
  });

  test("a pause of zero leaves the delay out and keeps the chain unbroken", () => {
    const values = { ...starterPackDefaults(raid), shoutoutDelaySeconds: 0 };
    const def = buildStarterWorkflow(raidItem, values, FULL_CATALOG);
    expect(def.tasks.map((task) => [task.id, task.dependsOn])).toEqual([
      ["thank-raider", undefined],
      ["shout-out-raider", ["thank-raider"]],
      ["mark-raid", ["shout-out-raider"]],
    ]);
  });

  test("a number field becomes a typed condition value", () => {
    const cheer = pack("cheer-thanks");
    const item = cheer.items[0];
    if (item.kind !== "workflow") {
      throw new Error("cheer thanks is a workflow");
    }
    const def = buildStarterWorkflow(item, { ...starterPackDefaults(cheer), cheerMinimum: 250 }, FULL_CATALOG);
    expect(def.trigger.conditions).toEqual([{ field: "${trigger.data.amount}", operator: "gte", value: 250 }]);
  });

  test("only thanks subscribers who were not gifted their sub", () => {
    const subs = pack("sub-hype");
    const item = subs.items.find((candidate) => candidate.id === "sub-thanks");
    if (item?.kind !== "workflow") {
      throw new Error("sub thanks is a workflow");
    }
    const def = buildStarterWorkflow(item, starterPackDefaults(subs), FULL_CATALOG);
    expect(def.trigger.conditions).toEqual([{ field: "${trigger.data.isGift}", operator: "eq", value: false }]);
  });

  test("dispatches a function-backed action by its function id", () => {
    const catalog: StarterCatalog = {
      triggers: FULL_CATALOG.triggers,
      actions: [{ canonicalRef: STARTER_ACTION_REFS.chatReply, functionCall: "chat.say" }],
    };
    const follow = pack("follower-thanks");
    const item = follow.items[0];
    if (item.kind !== "workflow") {
      throw new Error("follower thanks is a workflow");
    }
    const def = buildStarterWorkflow(item, starterPackDefaults(follow), catalog);
    expect(def.tasks[0]).toMatchObject({ action: "function", function: "chat.say" });
  });
});

describe("buildStarterCommand", () => {
  test("restricts the OBS commands to the broadcaster and moderators", () => {
    const brb = pack("brb-scene");
    const values = { ...starterPackDefaults(brb), brbScene: "Be Right Back" };
    const built = brb.items.map((item) => {
      if (item.kind !== "command") {
        throw new Error("BRB items are commands");
      }
      return buildStarterCommand(item, values, FULL_CATALOG);
    });
    expect(built.map((command) => command.command)).toEqual(["brb", "back"]);
    expect(built[0].restrictTo).toEqual(["broadcaster", "moderator"]);
    expect(built[0].actions).toEqual([
      {
        id: "switch-to-brb",
        action: "obs.switch_scene",
        parameters: { sceneName: "Be Right Back" },
        $ref: STARTER_ACTION_REFS.switchScene,
      },
    ]);
  });

  test("fills {user} with the chatter who ran the command", () => {
    const handy = pack("handy-commands");
    const lurk = handy.items.find((item) => item.id === "lurk");
    if (lurk?.kind !== "command") {
      throw new Error("lurk is a command");
    }
    const built = buildStarterCommand(lurk, starterPackDefaults(handy), FULL_CATALOG);
    expect(built.restrictTo).toEqual([]);
    expect(built.actions[0].parameters).toEqual({
      message: "${trigger.data.chatter} is lurking. Thanks for hanging out!",
    });
  });
});

describe("validateStarterValues", () => {
  const raid = pack("raid-welcome");

  test("refuses a placeholder the field's items do not offer, naming the ones they do", () => {
    const result = validateStarterValues(raid, { raidMessage: "Welcome {user}!" }, NO_FEATURES);
    expect(result).toEqual({
      ok: false,
      errors: { raidMessage: "{user} isn't a placeholder here. Use {raider}, {viewers}." },
    });
  });

  test("refuses engine expressions, which could reach the engine's environment", () => {
    const result = validateStarterValues(raid, { raidMessage: "Leaked: ${env.TWITCH_TOKEN}" }, NO_FEATURES);
    expect(result).toEqual({
      ok: false,
      errors: { raidMessage: "Engine expressions (${...}) aren't allowed here. Use the placeholders." },
    });
  });

  test("a pause is refused until the engine supports delays, and allowed once it does", () => {
    expect(validateStarterValues(raid, { shoutoutDelaySeconds: 5 }, NO_FEATURES)).toEqual({
      ok: false,
      errors: { shoutoutDelaySeconds: "Requires engine update. Leave it at 0." },
    });
    const withDelay = validateStarterValues(raid, { shoutoutDelaySeconds: 5 }, { delayWait: true });
    expect(withDelay.ok && withDelay.values.shoutoutDelaySeconds).toBe(5);
  });

  test("delays follow the engine's workflow.delayWait capability", () => {
    expect(starterFeaturesFrom([])).toEqual({ delayWait: false });
    expect(starterFeaturesFrom(["workflow.dryRun"])).toEqual({ delayWait: false });
    expect(starterFeaturesFrom(["obs.control", "workflow.delayWait"])).toEqual({ delayWait: true });
  });

  test("counts each placeholder at a display name's length against a field's limit", () => {
    // 100 characters of text plus one placeholder at 25 is over a marker's 140.
    const marker = `${"x".repeat(116)}{raider}`;
    expect(estimatedLength(marker)).toBe(141);
    expect(validateStarterValues(raid, { raidMarker: marker }, NO_FEATURES)).toEqual({
      ok: false,
      errors: { raidMarker: "Keep it under 140 characters, counting each placeholder as 25." },
    });
    expect(validateStarterValues(raid, { raidMarker: `${"x".repeat(115)}{raider}` }, NO_FEATURES).ok).toBe(true);
    expect(validateStarterValues(raid, { raidMessage: "x".repeat(501) }, NO_FEATURES)).toEqual({
      ok: false,
      errors: { raidMessage: "Keep it under 500 characters." },
    });
  });

  test("refuses numbers out of range or fractional, empty text and unknown fields", () => {
    const result = validateStarterValues(
      raid,
      {
        shoutoutDelaySeconds: 61,
        raidMessage: "   ",
        extra: "x",
      },
      NO_FEATURES
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        extra: "This pack has no such setting.",
        shoutoutDelaySeconds: "Enter a number from 0 to 60.",
        raidMessage: "This can't be empty.",
      },
    });
    expect(validateStarterValues(raid, { shoutoutDelaySeconds: 2.5 }, NO_FEATURES).ok).toBe(false);
  });

  test("a field two items read offers only the placeholders both have", () => {
    const subs = pack("sub-hype");
    expect(fieldTokenNames(subs, "giftBombMarker").sort()).toEqual(["count", "gifter"]);
    expect(fieldTokenNames(subs, "giftBombMinimum").sort()).toEqual(["count", "gifter"]);
  });

  test("trims text values, except exact ones such as scene names, which are flagged instead", () => {
    const result = validateStarterValues(raid, { raidMarker: "  Raid!  " }, NO_FEATURES);
    expect(result.ok && result.values.raidMarker).toBe("Raid!");

    const brb = pack("brb-scene");
    const scene = validateStarterValues(brb, { brbScene: "BRB " }, NO_FEATURES);
    expect(scene.ok && scene.values.brbScene).toBe("BRB ");
    const brbField = brb.fields.find((field) => field.id === "brbScene");
    if (!brbField) {
      throw new Error("no brbScene field");
    }
    expect(starterFieldWarning(brbField, "BRB ")).toBe(
      "Starts or ends with a space. OBS matches the name exactly, spaces included."
    );
    expect(starterFieldWarning(brbField, "BRB")).toBeNull();
  });
});

describe("missingRequirements", () => {
  function blockedItems(catalog: StarterCatalog): string[] {
    return STARTER_PACKS.flatMap((p) =>
      p.items.filter((item) => !hasRequirements(missingRequirements(item, catalog))).map((item) => `${p.id}/${item.id}`)
    );
  }

  test("an up-to-date instance can install everything", () => {
    expect(blockedItems(FULL_CATALOG)).toEqual([]);
  });

  test("an engine without the OBS actions holds back only the scene commands", () => {
    expect(blockedItems(OLD_ENGINE_CATALOG)).toEqual(["brb-scene/brb", "brb-scene/back"]);
    const brb = pack("brb-scene").items[0];
    expect(requirementsMessage(missingRequirements(brb, OLD_ENGINE_CATALOG))).toBe("Requires engine update");
  });

  test("an older Twitch module holds back the items that clip or mark, and asks for an update", () => {
    expect(blockedItems(OLD_TWITCH_MODULE_CATALOG)).toEqual([
      "raid-welcome/raid-welcome",
      "sub-hype/gift-bomb-clip",
      "brb-scene/brb",
      "brb-scene/back",
    ]);
    const raidItem = pack("raid-welcome").items[0];
    const missing = missingRequirements(raidItem, OLD_TWITCH_MODULE_CATALOG);
    expect(missing.actions).toEqual([STARTER_ACTION_REFS.marker]);
    expect(requirementsMessage(missing)).toBe("Requires the Twitch module (update it)");
  });

  test("without the Twitch module, its triggers and actions ask for the module", () => {
    const engineOnly: StarterCatalog = {
      triggers: [],
      actions: [catalogEntry(STARTER_ACTION_REFS.chatReply), catalogEntry(STARTER_ACTION_REFS.switchScene)],
    };
    const followItem = pack("follower-thanks").items[0];
    const missing = missingRequirements(followItem, engineOnly);
    expect(missing).toEqual({ triggers: ["channel.follow"], actions: [], twitchModuleInstalled: false });
    expect(requirementsMessage(missing)).toBe("Requires the Twitch module");
    const raidItem = pack("raid-welcome").items[0];
    expect(requirementsMessage(missingRequirements(raidItem, engineOnly))).toBe("Requires the Twitch module");
  });

  test("raid welcome needs twitch.marker, so Twitch module 0.7.0 (shoutout, no marker) never runs it", () => {
    const raidItem = pack("raid-welcome").items[0];
    const twitch070: StarterCatalog = {
      triggers: FULL_CATALOG.triggers,
      actions: [catalogEntry(STARTER_ACTION_REFS.chatReply), SHOUTOUT_0_7_0],
    };
    const missing = missingRequirements(raidItem, twitch070);
    expect(missing.actions).toContain(STARTER_ACTION_REFS.marker);
    expect(requirementsMessage(missing)).toBe("Requires the Twitch module (update it)");
  });

  test("a shoutout without the skipIfRateLimited input holds back raid welcome even with a marker", () => {
    const raidItem = pack("raid-welcome").items[0];
    const catalog: StarterCatalog = {
      triggers: FULL_CATALOG.triggers,
      actions: FULL_CATALOG.actions.map((action) =>
        action.canonicalRef === STARTER_ACTION_REFS.shoutout ? SHOUTOUT_0_7_0 : action
      ),
    };
    const missing = missingRequirements(raidItem, catalog);
    expect(missing.actions).toEqual([STARTER_ACTION_REFS.shoutout]);
    expect(requirementsMessage(missing)).toBe("Requires the Twitch module (update it)");
  });

  test("every step that sets skipIfRateLimited is gated on the action declaring it", () => {
    const withoutSkip: StarterCatalog = {
      triggers: FULL_CATALOG.triggers,
      actions: FULL_CATALOG.actions.map((action) => ({
        ...action,
        configFields: configFields(
          (ACTION_INPUTS[action.canonicalRef ?? ""] ?? []).filter((id) => id !== "skipIfRateLimited")
        ),
      })),
    };
    const gated: string[] = [];
    for (const p of STARTER_PACKS) {
      for (const item of p.items) {
        const setsSkip = item.steps.some((step) => step.kind === "action" && "skipIfRateLimited" in step.parameters);
        if (setsSkip) {
          expect(hasRequirements(missingRequirements(item, withoutSkip))).toBe(false);
          gated.push(`${p.id}/${item.id}`);
        }
      }
    }
    expect(gated).toEqual(["raid-welcome/raid-welcome"]);
  });

  test("an action whose catalog entry lists no fields is not judged on its inputs", () => {
    const followItem = pack("follower-thanks").items[0];
    const catalog: StarterCatalog = {
      triggers: FULL_CATALOG.triggers,
      actions: [{ canonicalRef: STARTER_ACTION_REFS.chatReply, handlerType: "chat.reply" }],
    };
    expect(hasRequirements(missingRequirements(followItem, catalog))).toBe(true);
  });

  test("an engine action missing alongside an older Twitch module asks for the engine first", () => {
    const raidItem = pack("raid-welcome").items[0];
    const catalog: StarterCatalog = {
      triggers: FULL_CATALOG.triggers,
      actions: [catalogEntry(STARTER_ACTION_REFS.shoutout)],
    };
    const missing = missingRequirements(raidItem, catalog);
    expect(missing.actions).toEqual([STARTER_ACTION_REFS.chatReply, STARTER_ACTION_REFS.marker]);
    expect(requirementsMessage(missing)).toBe("Requires engine update");
  });
});
