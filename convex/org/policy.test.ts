import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "../lib/convexTest.testing";
import type { EngineRole, OrgRole } from "../lib/organization";
import {
  type Action,
  can,
  ENGINE_ACTIONS,
  type EngineAction,
  ORG_ACTIONS,
  type Roles,
  requireActionFor,
} from "./policy";

const PERSONAS = {
  owner: { org: "owner", engine: "owner" },
  admin: { org: "admin", engine: "admin" },
  member: { org: "member", engine: "member" },
  engineAdminOnly: { org: "member", engine: "admin" },
  none: { org: null, engine: null },
} as const satisfies Record<string, Roles>;

type Persona = keyof typeof PERSONAS;

/** Who may take each action: every action and every persona, written out so a change to the tables shows here. */
const EXPECTED: Record<Action, Record<Persona, boolean>> = {
  viewOrganization: { owner: true, admin: true, member: true, engineAdminOnly: true, none: false },
  renameOrganization: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  manageMembers: { owner: true, admin: true, member: false, engineAdminOnly: false, none: false },
  viewMemberEmails: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  manageEngines: { owner: true, admin: true, member: false, engineAdminOnly: false, none: false },
  renameEngine: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  createEngine: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  changeEngineUrl: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  deleteEngine: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  viewBilling: { owner: true, admin: true, member: false, engineAdminOnly: false, none: false },
  manageBilling: { owner: true, admin: false, member: false, engineAdminOnly: false, none: false },
  viewEngine: { owner: true, admin: true, member: true, engineAdminOnly: true, none: false },
  operateEngine: { owner: true, admin: true, member: false, engineAdminOnly: true, none: false },
  manageEngineMembers: { owner: true, admin: true, member: false, engineAdminOnly: true, none: false },
};

const ACTIONS: Action[] = [...ORG_ACTIONS, ...ENGINE_ACTIONS];

test("the expected table names every action", () => {
  expect(Object.keys(EXPECTED).sort()).toEqual([...ACTIONS].sort());
});

describe("can", () => {
  for (const action of ACTIONS) {
    for (const [persona, roles] of Object.entries(PERSONAS) as Array<[Persona, Roles]>) {
      const allowed = EXPECTED[action][persona];
      test(`${persona} ${allowed ? "may" : "may not"} ${action}`, () => {
        expect(can(roles, action)).toBe(allowed);
      });
    }
  }
});

async function seed() {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const users = {} as Record<Persona, Id<"users">>;
    for (const persona of Object.keys(PERSONAS) as Persona[]) {
      users[persona] = await ctx.db.insert("users", { name: persona });
    }
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId: users.owner, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      createdAt: 1,
    });
    for (const persona of Object.keys(PERSONAS) as Persona[]) {
      const roles: { org: OrgRole | null; engine: EngineRole | null } = PERSONAS[persona];
      if (roles.org !== null) {
        await ctx.db.insert("accountMembers", { accountId, userId: users[persona], role: roles.org, createdAt: 1 });
      }
      if (roles.engine !== null) {
        await ctx.db.insert("instanceMembers", { instanceId, userId: users[persona], role: roles.engine });
      }
    }
    return { users, accountId, instanceId };
  });
  return { t, ...ids };
}

describe("requireActionFor reads the roles from the database", () => {
  for (const action of ACTIONS) {
    for (const persona of Object.keys(PERSONAS) as Persona[]) {
      const allowed = EXPECTED[action][persona];
      test(`${persona} on the engine ${allowed ? "may" : "may not"} ${action}`, async () => {
        const f = await seed();
        const attempt = f.t.run((ctx) =>
          requireActionFor<Action>(ctx, f.users[persona], { engine: f.instanceId }, action)
        );
        if (allowed) {
          expect((await attempt).account._id).toBe(f.accountId);
        } else {
          await expect(attempt).rejects.toMatchObject({ data: { code: "not_authorized", action } });
        }
      });
    }
  }

  test("an org action on the org is decided by the org role alone", async () => {
    const f = await seed();
    const actor = await f.t.run((ctx) => requireActionFor(ctx, f.users.admin, { org: f.accountId }, "manageMembers"));
    expect(actor.roles).toEqual({ org: "admin", engine: null });
  });

  test("a missing engine is its own refusal", async () => {
    const f = await seed();
    await f.t.run((ctx) => ctx.db.delete(f.instanceId));
    await expect(
      f.t.run((ctx) => requireActionFor(ctx, f.users.owner, { engine: f.instanceId }, "viewEngine"))
    ).rejects.toMatchObject({ data: { code: "engine_not_found" } });
  });

  test("an engine action is refused on an org subject", async () => {
    const f = await seed();
    const engineAction: EngineAction = "viewEngine";
    await expect(
      f.t.query(internal.org.policy.authorize, {
        userId: f.users.owner,
        subject: { org: f.accountId },
        action: engineAction,
      })
    ).rejects.toThrow("needs an engine subject");
  });
});
