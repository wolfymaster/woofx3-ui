import { describe, expect, test } from "bun:test";
import {
  functionLocation,
  installedFunctionSummaries,
  marketplaceFunctionSummaries,
  type RegisteredFunction,
} from "./moduleFunctionSummary";

const manifest = {
  id: "spam_battle",
  functions: [
    {
      id: "handle_chat_message",
      name: "Handle chat message",
      runtime: "js",
      path: "functions/battle.js",
      entryPoint: "handle_chat_message",
    },
  ],
};

function row(overrides: Partial<RegisteredFunction> = {}): RegisteredFunction {
  return {
    qualifiedName: "spam_battle:function:handle_chat_message",
    manifestId: "handle_chat_message",
    functionName: "handle_chat_message",
    fileName: "battle.js",
    entryPoint: "handle_chat_message",
    runtime: "js",
    ...overrides,
  };
}

describe("installedFunctionSummaries", () => {
  test("takes the module-relative path and display name from the stored manifest", () => {
    expect(installedFunctionSummaries([row()], manifest)).toEqual([
      {
        qualifiedName: "spam_battle:function:handle_chat_message",
        name: "Handle chat message",
        file: "functions/battle.js",
        entryPoint: "handle_chat_message",
        runtime: "js",
      },
    ]);
  });

  test("falls back to the registered file name when no manifest is stored", () => {
    const [summary] = installedFunctionSummaries([row()], undefined);
    expect(summary.file).toBe("battle.js");
    expect(summary.name).toBe("handle_chat_message");
  });

  test("leaves blank registered fields out rather than showing empty text", () => {
    const [summary] = installedFunctionSummaries(
      [row({ manifestId: undefined, functionName: "", fileName: "", entryPoint: "", runtime: "" })],
      undefined
    );
    expect(summary).toEqual({
      qualifiedName: "spam_battle:function:handle_chat_message",
      name: "spam_battle:function:handle_chat_message",
    });
  });
});

describe("marketplaceFunctionSummaries", () => {
  test("reads path and entry point from the archive manifest", () => {
    const [summary] = marketplaceFunctionSummaries("spam_battle", [], manifest);
    expect(summary).toEqual({
      qualifiedName: "spam_battle:function:handle_chat_message",
      name: "Handle chat message",
      file: "functions/battle.js",
      entryPoint: "handle_chat_message",
      runtime: "js",
    });
  });

  test("uses the listing's id, name and runtime when the archive is unreadable", () => {
    const listed = [{ id: "start_battle", name: "Start battle", runtime: "js" }, { name: "no id" }];
    expect(marketplaceFunctionSummaries("spam_battle", listed, null)).toEqual([
      { qualifiedName: "spam_battle:function:start_battle", name: "Start battle", runtime: "js" },
    ]);
  });
});

describe("functionLocation", () => {
  test("joins file and entry point, or shows whichever is known", () => {
    expect(functionLocation({ file: "functions/battle.js", entryPoint: "run" })).toBe("functions/battle.js → run");
    expect(functionLocation({ file: "battle.js" })).toBe("battle.js");
    expect(functionLocation({ entryPoint: "run" })).toBe("run");
    expect(functionLocation({})).toBeNull();
  });
});
