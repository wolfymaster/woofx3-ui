import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import type { EngineApi } from "../../engineInstanceUrl";
import { engineCapabilitiesStep } from "./engineCapabilities";

describe("engineCapabilitiesStep", () => {
  test("stores what the engine advertises", async () => {
    const sent: { name: string; args: Record<string, unknown> }[] = [];
    const ctx = {
      runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
        sent.push({ name: getFunctionName(ref), args });
      },
    } as unknown as ActionCtx;
    const newApi = () =>
      ({
        getEngineCapabilities: async () => ({ schema: 1, capabilities: ["workflows.groups"] }),
      }) as unknown as EngineApi;

    const result = await engineCapabilitiesStep.run({ ctx, newApi, instanceId: "instance1" as Id<"instances"> });

    expect(result).toEqual({ itemsProcessed: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe("engineCapabilities:store");
    expect(sent[0]?.args.capabilities).toEqual(["workflows.groups"]);
    expect(sent[0]?.args.instanceId).toBe("instance1");
  });
});
