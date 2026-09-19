import { describe, expect, test } from "bun:test";
import { type SentenceField, type SentencePart, sentenceParts, sentenceText } from "./condition-sentence";

const REWARD: SentenceField = { id: "reward", label: "Reward", type: "select" };
const TIER: SentenceField = {
  id: "tier",
  label: "Subscription tier",
  type: "select",
  options: [
    { value: "1000", label: "Tier 1" },
    { value: "2000", label: "Tier 2" },
  ],
};
const VIEWERS: SentenceField = { id: "minViewers", label: "Minimum viewers", type: "number", operator: "gte" };

function states(parts: SentencePart[]) {
  return parts.map((part) => (part.kind === "field" ? `[${part.state}:${part.text}]` : part.text)).join("");
}

describe("sentenceParts", () => {
  test("puts a loaded option's label where its value goes", () => {
    const labels = new Map([["reward", new Map([["9e3a", "Test"]])]]);
    const parts = sentenceParts("{reward} is redeemed", [REWARD], { reward: "9e3a" }, labels);
    expect(states(parts)).toBe("[value:Test] is redeemed");
  });

  test("uses a static option's label", () => {
    expect(sentenceText(sentenceParts("Someone subs at {tier}", [TIER], { tier: "2000" }))).toBe(
      "Someone subs at Tier 2"
    );
  });

  test("reads a missing required value with an article, capitalized", () => {
    expect(states(sentenceParts("{reward} is redeemed", [REWARD], {}))).toBe("[missing:A reward] is redeemed");
  });

  test("reads Any in the field's generic words", () => {
    expect(states(sentenceParts("Someone subs at {tier}", [TIER], { tier: null }))).toBe(
      "Someone subs at [any:any subscription tier]"
    );
  });

  test("prefers the author's any and missing wording", () => {
    const field = { ...REWARD, anyText: "any reward", missingText: "A reward" };
    expect(sentenceText(sentenceParts("{reward} is redeemed", [field], { reward: null }))).toBe(
      "Any reward is redeemed"
    );
    expect(sentenceText(sentenceParts("{reward} is redeemed", [field], {}))).toBe("A reward is redeemed");
  });

  test("drops a part whose any wording is empty", () => {
    const anon = { id: "anon", label: "Anonymous", type: "toggle", anyText: "" } as SentenceField;
    expect(sentenceText(sentenceParts("Someone cheers{anon}", [anon], { anon: null }))).toBe("Someone cheers");
  });

  test("phrases a number by its comparison", () => {
    expect(sentenceText(sentenceParts("A raid brings {minViewers} viewers", [VIEWERS], { minViewers: 1000 }))).toBe(
      "A raid brings 1,000 or more viewers"
    );
  });

  test("keeps a placeholder naming no field as written", () => {
    expect(sentenceText(sentenceParts("{nope} happened", [], {}))).toBe("{nope} happened");
  });

  test("without a template, lists each field's label and value", () => {
    expect(sentenceText(sentenceParts(undefined, [TIER, VIEWERS], { tier: "1000", minViewers: 5 }))).toBe(
      "Subscription tier: Tier 1 · Minimum viewers: 5 or more"
    );
  });
});
