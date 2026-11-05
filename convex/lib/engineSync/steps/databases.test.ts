import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import type { EngineApi } from "../../engineInstanceUrl";
import { databasesStep } from "./databases";

describe("databasesStep", () => {
  test("a database the engine can't list fails the step but not the databases after it", async () => {
    const finished: unknown[] = [];
    // stylegate:ignore ANY-TST-004 reason="the step needs only these calls; a full ActionCtx or EngineApi double would be the whole Convex and engine surface, as in modules.test.ts"
    const ctx = {
      runQuery: async () => ["woofx3:database:broken", "woofx3:database:games"],
      runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: { databaseId: string }) => {
        if (getFunctionName(ref) === "userPageDatabases:finishReconcile") {
          finished.push(args.databaseId);
        }
        return { itemsProcessed: 0 };
      },
    } as unknown as ActionCtx;
    // stylegate:ignore ANY-TST-004 reason="the step needs only these calls; a full ActionCtx or EngineApi double would be the whole Convex and engine surface, as in modules.test.ts"
    const newApi = () =>
      ({
        listPublicDatabaseRecords: async (databaseId: string) => {
          if (databaseId === "woofx3:database:broken") {
            throw new Error("engine said no");
          }
          return { records: [], total: 0 };
        },
      }) as unknown as EngineApi;

    await expect(databasesStep.run({ ctx, newApi, instanceId: "instance1" as Id<"instances"> })).rejects.toThrow(
      "woofx3:database:broken: engine said no"
    );
    expect(finished).toEqual(["woofx3:database:games"]);
  });
});
