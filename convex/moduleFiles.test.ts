import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { INSTALL_TO_BROWSE_MESSAGE } from "@shared/module-files";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";

const realFetch = globalThis.fetch;
let fetchedUrls: string[] = [];

beforeEach(() => {
  fetchedUrls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchedUrls.push(String(input));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function seedOwner() {
  const t = newBackend();
  const { userId, instanceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId: userId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Engine",
      url: "https://e.example",
      createdAt: 1,
    });
    await ctx.db.insert("accountMembers", { accountId, userId, role: "owner", createdAt: 1 });
    await ctx.db.insert("instanceMembers", { instanceId, userId, role: "owner" });
    return { userId, instanceId };
  });
  return { as: t.withIdentity({ subject: `${userId}|session` }), instanceId };
}

describe("module files of a listing that is not installed", () => {
  test("the list says it is not installed and downloads nothing", async () => {
    const { as, instanceId } = await seedOwner();
    expect(await as.action(api.moduleFiles.listModuleFiles, { instanceId, moduleId: "cozy" })).toEqual({
      available: false,
      files: [],
      notInstalled: true,
    });
    expect(fetchedUrls).toEqual([]);
  });

  test("reading a file asks to install the module and downloads nothing", async () => {
    const { as, instanceId } = await seedOwner();
    const error = await as
      .action(api.moduleFiles.readModuleFile, { instanceId, moduleId: "cozy", path: "main.lua" })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<string>).data).toBe(INSTALL_TO_BROWSE_MESSAGE);
    expect(fetchedUrls).toEqual([]);
  });
});
