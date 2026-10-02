import { describe, expect, test } from "bun:test";
import { CHAT_COMMAND_CONTEXT, eventContext, SCHEDULE_CONTEXT } from "./events";
import { translateFirebotText, translateStreamerbotText, unknownVariablesMessage } from "./templates";

describe("translateFirebotText", () => {
  test("maps the user and arguments of a chat command", () => {
    const result = translateFirebotText("Hi $user, you said $arg[1] then $arg[2]", CHAT_COMMAND_CONTEXT);
    expect(result.text).toBe(
      "Hi ${trigger.data.chatter}, you said ${trigger.data.args[0]} then ${trigger.data.args[1]}"
    );
    expect(result.unknown).toEqual([]);
  });

  test("maps event data to the event's own fields", () => {
    const raid = translateFirebotText("$username raids with $raidViewerCount", eventContext("channel.raid"));
    expect(raid.text).toBe("${trigger.data.fromBroadcasterUserName} raids with ${trigger.data.viewers}");
    const cheer = translateFirebotText("$cheerBitsAmount bits: $cheerMessage", eventContext("channel.cheer"));
    expect(cheer.text).toBe("${trigger.data.amount} bits: ${trigger.data.message}");
  });

  test("reads everything after the command word for $arg[all]", () => {
    expect(translateFirebotText("$arg[all]", CHAT_COMMAND_CONTEXT).text).toBe("${trigger.data.text}");
  });

  test("leaves a variable the context lacks as written and reports it", () => {
    const result = translateFirebotText("Viewers: $raidViewerCount, at $time", CHAT_COMMAND_CONTEXT);
    expect(result.text).toBe("Viewers: $raidViewerCount, at $time");
    expect(result.unknown).toEqual(["$raidViewerCount", "$time"]);
  });

  test("reports bracketed variables whole, nested brackets included", () => {
    const result = translateFirebotText("$counter[Deaths] and $if[$arg[1] == a, x, y]!", CHAT_COMMAND_CONTEXT);
    expect(result.unknown).toEqual(["$counter[Deaths]", "$if[$arg[1] == a, x, y]"]);
    expect(result.text).toBe("$counter[Deaths] and $if[$arg[1] == a, x, y]!");
  });

  test("keeps prices and lone dollar signs", () => {
    const result = translateFirebotText("Only $5 or $ more", CHAT_COMMAND_CONTEXT);
    expect(result.text).toBe("Only $5 or $ more");
    expect(result.unknown).toEqual([]);
  });

  test("fills preset list arguments and reports other shorthands", () => {
    const result = translateFirebotText("$#greeting $$customVar", SCHEDULE_CONTEXT, { greeting: "hello" });
    expect(result.text).toBe("hello $$customVar");
    expect(result.unknown).toEqual(["$$customVar"]);
  });
});

describe("translateStreamerbotText", () => {
  test("maps the user and inputs of a chat command", () => {
    const result = translateStreamerbotText("%user% asked for %input0%: %rawInput%", CHAT_COMMAND_CONTEXT);
    expect(result.text).toBe("${trigger.data.chatter} asked for ${trigger.data.args[0]}: ${trigger.data.text}");
  });

  test("reads %rawInput% as the message where there is no command text", () => {
    const result = translateStreamerbotText("%rawInput%", eventContext("channelpoints.redeem"));
    expect(result.text).toBe("${trigger.data.message}");
  });

  test("ignores format specifiers on known variables", () => {
    expect(translateStreamerbotText("%bits:N0% bits", eventContext("channel.cheer")).text).toBe(
      "${trigger.data.amount} bits"
    );
  });

  test("reports globals, inline functions and unknown arguments", () => {
    const result = translateStreamerbotText("~deaths~ $math(1+1)$ %myArg%", CHAT_COMMAND_CONTEXT);
    expect(result.unknown).toEqual(["~deaths~", "$math(1+1)$", "%myArg%"]);
  });

  test("leaves percentages in prose alone", () => {
    const result = translateStreamerbotText("50% off and 20% more", CHAT_COMMAND_CONTEXT);
    expect(result.text).toBe("50% off and 20% more");
    expect(result.unknown).toEqual([]);
  });
});

describe("unknownVariablesMessage", () => {
  test("lists each variable once", () => {
    expect(unknownVariablesMessage(["$a", "$a"])).toBe(
      "Uses $a, which woofx3 has no value for here, so it is sent as written."
    );
    expect(unknownVariablesMessage(["$a", "$b"])).toContain("$a, $b");
  });
});
