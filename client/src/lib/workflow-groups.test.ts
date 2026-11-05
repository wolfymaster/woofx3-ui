import { describe, expect, test } from "bun:test";
import type { Workflow, WorkflowGroup } from "@/engine/types";
import { cardGroupIds, cardWorkflowIds, groupableCards, triggersReleasedBy } from "@/lib/workflow-groups";

function workflow(id: string, event: string, groupIds: string[], conditions: unknown[] = []): Workflow {
  return {
    engineWorkflowId: id,
    definition: { name: id, trigger: { type: "event", event, conditions }, tasks: [] },
    isEnabled: true,
    groupIds,
    createdAt: 0,
    updatedAt: 0,
  };
}

const AMOUNT_FIELD = ["$", "{trigger.data.amount}"].join("");
const bigCheer = [{ field: AMOUNT_FIELD, operator: "gte", value: 100 }];

describe("groupableCards", () => {
  test("one card per event and set of conditions, with every workflow on it", () => {
    const cards = groupableCards(
      [
        workflow("w-1", "channel.cheer", []),
        workflow("w-2", "channel.cheer", [], bigCheer),
        workflow("w-3", "channel.cheer", [], bigCheer),
        workflow("w-4", "channel.follow", []),
      ],
      []
    );
    expect(cards.map(cardWorkflowIds)).toEqual([["w-1"], ["w-2", "w-3"], ["w-4"]]);
    expect(cards[1]?.conditionsLabel).not.toBe("");
  });
});

describe("cardGroupIds", () => {
  test("a card is in a group only when all of its workflows are", () => {
    const [card] = groupableCards(
      [workflow("w-1", "channel.cheer", ["g-1", "g-2"]), workflow("w-2", "channel.cheer", ["g-1"])],
      []
    );
    expect(card && cardGroupIds(card)).toEqual(["g-1"]);
  });

  test("a card partly in a group is not in it", () => {
    const [card] = groupableCards(
      [workflow("w-1", "channel.cheer", ["g-1"]), workflow("w-2", "channel.cheer", [])],
      []
    );
    expect(card && cardGroupIds(card)).toEqual([]);
  });
});

describe("triggersReleasedBy", () => {
  const group = (id: string, enabled: boolean, memberIds: string[]): WorkflowGroup => ({
    engineGroupId: id,
    name: id,
    description: "",
    enabled,
    memberIds,
  });

  test("counts the triggers no other group that is on holds", () => {
    const a = group("a", true, ["w-1", "w-2"]);
    expect(triggersReleasedBy(a, [a, group("b", true, ["w-2"]), group("c", false, ["w-1"])])).toBe(1);
  });

  test("a group that is off changes nothing", () => {
    const a = group("a", false, ["w-1"]);
    expect(triggersReleasedBy(a, [a])).toBe(0);
  });
});
