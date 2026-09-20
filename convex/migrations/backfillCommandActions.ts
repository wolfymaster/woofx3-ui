import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-time: rewrite each cached chat command's `type`/`typeValue` pair into the
 * ordered action list that does what it used to do.
 *
 *   bunx convex run migrations/backfillCommandActions:default
 *
 * Mirrors the engine's own rewrite (0044_command_actions, package
 * `db/database/migrate/migrations/commandactions` in the woofx3 engine repo) so
 * a row converted here reads the same as the snapshot the engine's next
 * listCommands() sync will send for it.
 *
 * Idempotent — a row that already holds `actions` is left alone.
 */
export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    // The legacy fields are gone from the schema, so they are invisible to
    // `Doc<"chatCommands">` and have to be read off the raw row.
    const rows = (await ctx.db.query("chatCommands").collect()) as Array<
      Doc<"chatCommands"> & { type?: string; typeValue?: string }
    >;

    let converted = 0;
    for (const row of rows) {
      if (row.actions !== undefined) {
        continue;
      }
      await ctx.db.patch(row._id, {
        actions: actionsFor(row.type ?? "text", row.typeValue ?? ""),
        // Clearing a field the schema no longer declares: `patch` drops a field
        // set to undefined, but Doc<"chatCommands"> has no name for it.
        ...({ type: undefined, typeValue: undefined } as Partial<Doc<"chatCommands">>),
      });
      converted++;
    }

    return { scanned: rows.length, converted };
  },
});

/**
 * One pre-actions command as the action list that does what it used to do: a
 * text response becomes a single `chat.reply`, a function becomes a single
 * `function` step naming the same function, and a command with nothing to say
 * becomes an empty list — which still announces itself on
 * `chat.command.<slug>`, as a trigger-only command always has.
 *
 * One exception: a module command declaring a workflow was stored as a
 * "function" holding a *workflow* canonical id, which the runtime then invoked
 * as if it were a function. Those become a workflow step, which is what they
 * always meant.
 */
function actionsFor(commandType: string, typeValue: string): unknown[] {
  const value = typeValue.trim();
  if (value === "") {
    return [];
  }
  if (commandType === "function" && value.includes(":workflow:")) {
    return [{ id: "action-1", type: "workflow", workflow: { workflowId: value, waitUntilCompletion: false } }];
  }
  if (commandType === "function") {
    return [{ id: "action-1", action: "function", function: value }];
  }
  return [{ id: "action-1", action: "chat.reply", parameters: { message: templateToExpressions(value) } }];
}

// What a text response could refer to besides its own declared arguments — the
// resolver context woofwoofwoof built for it. Everything else in braces was an
// argumentPattern capture, which now arrives under `variables` on the trigger
// event.
const FIXED_NAMES: Record<string, string> = {
  user: "trigger.data.chatter",
  args: "trigger.data.args",
  argsText: "trigger.data.text",
  rawMessage: "trigger.data.rawMessage",
  command: "trigger.data.command",
};

/**
 * Rewrites a response's `{name}` templates into the `${...}` expressions the
 * workflow resolver evaluates, so a migrated command still greets the right
 * person.
 */
function templateToExpressions(text: string): string {
  return text.replace(/\{([A-Za-z0-9_.]+)\}/g, (_match, name: string) => {
    const path = FIXED_NAMES[name];
    return path ? `\${${path}}` : `\${trigger.data.variables.${name}}`;
  });
}
