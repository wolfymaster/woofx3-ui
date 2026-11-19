// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures hold engine ${...} expressions as plain strings
import { afterEach, describe, expect, test } from "bun:test";
import { escapeDollarKeys } from "@shared/dollar-keys";
import { newHttpBatchRpcResponse, RpcTarget } from "capnweb";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { resolveWorkflowCorrelation } from "./workflowInternal";

type Backend = ReturnType<typeof newBackend>;

const CHEER_TRIGGER = {
  type: "event",
  event: "channel.cheer",
  conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
};

function cheerDefinition(
  name: string,
  tasks: unknown[] = [{ id: "existing-step", type: "action", action: "chat.reply" }]
) {
  return { name, description: "Existing", trigger: CHEER_TRIGGER, tasks };
}

/** Answers through capnweb's real batch handling, so each session is used once as in production. */
class FakeEngine extends RpcTarget {
  readonly workflows = new Map<string, boolean>();
  readonly definitions = new Map<string, unknown>();
  readonly createCalls: unknown[] = [];
  readonly updateCalls: Array<{ id: string; definition: unknown }> = [];

  constructor(
    private readonly t: Backend,
    private readonly instanceId: Id<"instances">
  ) {
    super();
  }

  authenticate(): FakeEngine {
    return this;
  }

  putWorkflow(id: string, _name: string, isEnabled: boolean, definition: unknown) {
    this.workflows.set(id, isEnabled);
    this.definitions.set(id, definition);
  }

  getWorkflows({ page = 1 }: { page?: number } = {}) {
    const workflows =
      page === 1
        ? [...this.workflows].map(([id, isEnabled]) => ({
            id,
            name: (this.definitions.get(id) as { name: string } | undefined)?.name ?? id,
            isEnabled,
            definition: this.definitions.get(id) ?? null,
          }))
        : [];
    return { workflows, total: this.workflows.size, page, pageSize: 100 };
  }

  async createWorkflow(input: { definition: unknown; correlationKey: string }) {
    this.createCalls.push(input);
    const id = `workflow-${this.workflows.size + 1}`;
    this.workflows.set(id, false);
    this.definitions.set(id, input.definition);
    await this.echo(id, input.definition, false, input.correlationKey);
    return { id, definition: input.definition, isEnabled: false };
  }

  async updateWorkflow(id: string, input: { definition: unknown; correlationKey: string }) {
    this.updateCalls.push({ id, definition: input.definition });
    this.definitions.set(id, input.definition);
    await this.echo(id, input.definition, this.workflows.get(id) ?? true, input.correlationKey);
    return { id, definition: input.definition, isEnabled: this.workflows.get(id) ?? true, revision: 1 };
  }

  private async echo(engineWorkflowId: string, definition: unknown, isEnabled: boolean, correlationKey: string) {
    await this.t.mutation(internal.workflowInternal.upsertFromWebhook, {
      instanceId: this.instanceId,
      engineWorkflowId,
      definition: escapeDollarKeys(definition),
      isEnabled,
    });
    await this.t.run((ctx) => resolveWorkflowCorrelation(ctx, { correlationKey, engineWorkflowId, op: "update" }));
  }
}

async function setup() {
  const t = newBackend();
  const { instanceId, ownerId } = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.patch(instanceId, { clientId: "client", clientSecret: "secret" });

    await ctx.db.insert("triggerDefinitions", {
      slug: "channel.cheer",
      name: "Cheer",
      description: "",
      category: "",
      color: "",
      icon: "",
      event: "channel.cheer",
    });
    await ctx.db.insert("instanceTriggers", { instanceId, triggerId: "channel.cheer" });
    await ctx.db.insert("actionDefinitions", {
      slug: "chat.reply",
      name: "Reply",
      description: "",
      category: "",
      color: "",
      icon: "",
      handlerType: "function",
      projectionKey: "woofx3:action:chat.reply",
    });
    await ctx.db.insert("instanceActions", { instanceId, actionId: "chat.reply" });
    return { instanceId, ownerId };
  });
  return { t, instanceId, ownerId };
}

describe("hosted starter-pack install evaluates existing triggers", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function connect(engine: FakeEngine) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      newHttpBatchRpcResponse(new Request(input, init), engine)) as typeof fetch;
  }

  test("extends a matching trigger, creates nothing, and completes the ledger with its id", async () => {
    const { t, instanceId, ownerId } = await setup();
    const engine = new FakeEngine(t, instanceId);
    engine.putWorkflow("existing", "My cheer alert", true, cheerDefinition("My cheer alert"));
    connect(engine);

    const results = await t
      .withIdentity({ subject: `${ownerId}|session` })
      .action(api.starterPacks.install, { instanceId, packId: "cheer-thanks", values: {} });

    expect(results.results.map((result) => result.outcome)).toEqual(["installed"]);
    expect(engine.createCalls).toHaveLength(0);
    expect(engine.updateCalls).toHaveLength(1);
    expect(engine.updateCalls[0].id).toBe("existing");
    const appended = engine.updateCalls[0].definition as {
      name: string;
      tasks: Array<{ id: string; dependsOn?: string[] }>;
    };
    expect(appended.name).toBe("My cheer alert");
    expect(appended.tasks.map((task) => task.id)).toEqual(["existing-step", "thank-cheerer"]);
    expect(appended.tasks[1].dependsOn).toEqual(["existing-step"]);

    const ledger = await t.run((ctx) =>
      ctx.db
        .query("starterPackItems")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .collect()
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].engineId).toBe("existing");

    const again = await t
      .withIdentity({ subject: `${ownerId}|session` })
      .action(api.starterPacks.install, { instanceId, packId: "cheer-thanks", values: {} });
    expect(again.results.map((result) => result.outcome)).toEqual(["already-installed"]);
    expect(engine.updateCalls).toHaveLength(1);
  });

  test("setup import workflow apply extends a matching trigger instead of creating one", async () => {
    const { t, instanceId, ownerId } = await setup();
    const engine = new FakeEngine(t, instanceId);
    engine.putWorkflow("existing", "Imported cheer alert", true, cheerDefinition("Imported cheer alert"));
    connect(engine);

    const importId = await t.mutation(internal.setupImports.createRun, {
      instanceId,
      source: "firebot",
      label: "Test import",
      createdByUserId: ownerId,
      leftovers: [],
    });
    await t.mutation(internal.setupImports.insertItems, {
      importId,
      items: [
        {
          order: 0,
          key: "cheer",
          kind: "workflow",
          name: "Imported cheer alert",
          origin: "Test",
          readiness: "ready",
          notes: [],
          steps: [],
          spec: {
            name: "Imported cheer alert",
            description: "",
            enabled: true,
            trigger: { kind: "event", event: "channel.cheer", conditions: CHEER_TRIGGER.conditions, logic: "and" },
            steps: [
              {
                kind: "action",
                label: "Say thanks",
                ref: "woofx3:action:chat.reply",
                parameters: { message: "thanks" },
              },
            ],
          },
        },
      ],
    });
    await t.withIdentity({ subject: `${ownerId}|session` }).mutation(api.setupImports.start, { importId });
    await t.action(internal.setupImports.apply, { importId });

    expect(engine.createCalls).toHaveLength(0);
    expect(engine.updateCalls).toHaveLength(1);
    expect(engine.updateCalls[0].id).toBe("existing");
    const item = await t.run((ctx) =>
      ctx.db
        .query("setupImportItems")
        .withIndex("by_import", (q) => q.eq("importId", importId))
        .first()
    );
    expect(item?.engineId).toBe("existing");
  });

  test("never extends a paused or module-owned workflow", async () => {
    for (const [name, isEnabled] of [
      ["Paused cheer alert", false],
      ["twitch/cheer alert", true],
    ] as const) {
      const { t, instanceId, ownerId } = await setup();
      const engine = new FakeEngine(t, instanceId);
      engine.putWorkflow("existing", name, isEnabled, cheerDefinition(name));
      connect(engine);

      const results = await t
        .withIdentity({ subject: `${ownerId}|session` })
        .action(api.starterPacks.install, { instanceId, packId: "cheer-thanks", values: {} });

      expect(results.results.map((result) => result.outcome)).toEqual(["installed"]);
      expect(engine.createCalls).toHaveLength(1);
      expect(engine.updateCalls).toHaveLength(0);
    }
  });
});
