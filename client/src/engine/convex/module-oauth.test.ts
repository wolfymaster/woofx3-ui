import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// Connecting a module's OAuth integration under the Convex gateway: Convex
// builds the authorize URL and later redeems the callback's one-time code.

const calls: Array<{ name: string; args: unknown }> = [];
let finishAnswer: unknown = null;

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    const name = getFunctionName(action);
    calls.push({ name, args });
    if (name === "moduleOAuth:start") {
      return Promise.reject(new Error("This engine cannot connect integrations"));
    }
    return Promise.resolve(finishAnswer);
  },
}));

const { convexModuleOAuthGateway, toModuleOAuthFinish } = await import("./module-oauth");

beforeEach(() => {
  calls.length = 0;
});

describe("toModuleOAuthFinish", () => {
  const cases: Array<{ name: string; result: Parameters<typeof toModuleOAuthFinish>[0]; expected: unknown }> = [
    {
      name: "a finished connect names its integration and drops Convex's return path",
      result: { ok: true, redirectTo: "/modules/spotify", integration: "spotify" },
      expected: { ok: true, integration: "spotify" },
    },
    {
      name: "a refused connect keeps its error code",
      result: { ok: false, error: "invalid_state" },
      expected: { ok: false, error: "invalid_state" },
    },
  ];
  for (const { name, result, expected } of cases) {
    test(name, () => {
      expect(toModuleOAuthFinish(result)).toEqual(expected);
    });
  }
});

describe("moduleOAuth requests", () => {
  test("connecting asks for the authorize URL with the page to come back to, and rejects a refusal", async () => {
    const connect = renderInScope(() => convexModuleOAuthGateway.useConnectRequest());
    await expect(
      connect({ moduleId: "spotify", integration: "spotify", returnTo: "/modules/spotify" })
    ).rejects.toThrow("This engine cannot connect integrations");
    expect(calls).toEqual([
      {
        name: "moduleOAuth:start",
        args: {
          instanceId: TEST_INSTANCE_ID,
          moduleId: "spotify",
          integration: "spotify",
          redirectTo: "/modules/spotify",
        },
      },
    ]);
  });

  test("finishing redeems the connect code", async () => {
    finishAnswer = { ok: true, redirectTo: "/modules/spotify", integration: "spotify" };
    const finish = renderInScope(() => convexModuleOAuthGateway.useFinishRequest(), null);
    expect(await finish("code-1")).toEqual({ ok: true, integration: "spotify" });
    expect(calls).toEqual([{ name: "moduleOAuth:finish", args: { code: "code-1" } }]);
  });
});
