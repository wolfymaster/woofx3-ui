import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-time: lift macro-pad buttons out of each user's dashboardLayouts config
 * blob into the instance-scoped `macros` table.
 *
 *   bunx convex run migrations/backfillSharedMacros:default
 *
 * Macros used to live in `panel.widgets[].config.macros`, inside a row that is
 * per user — so two members of one account each had their own list. They are now
 * shared per instance, which means an instance whose users hold different lists
 * has no single correct answer. This seeds each instance from the first
 * non-empty list it finds and reports every list it skipped, so nothing is
 * silently discarded: the skipped ones are still in their original blobs and can
 * be merged by hand.
 *
 * Idempotent — an instance that already has macros is left alone.
 */
export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    const layouts = await ctx.db.query("dashboardLayouts").collect();

    let macrosInserted = 0;
    const skipped: Array<{ instanceId: Id<"instances">; userId: Id<"users">; macroCount: number }> = [];
    const seededInstances = new Set<string>();

    for (const layout of layouts) {
      const macros = collectMacros(layout);
      if (macros.length === 0) {
        continue;
      }

      const existing = await ctx.db
        .query("macros")
        .withIndex("by_instance_and_sort_order", (q) => q.eq("instanceId", layout.instanceId))
        .first();

      // Already seeded — either by an earlier run, or by another user's row in
      // this same run.
      if (existing || seededInstances.has(layout.instanceId)) {
        skipped.push({ instanceId: layout.instanceId, userId: layout.userId, macroCount: macros.length });
        continue;
      }

      const now = Date.now();
      seededInstances.add(layout.instanceId);

      for (let index = 0; index < macros.length; index++) {
        const macro = macros[index];
        await ctx.db.insert("macros", {
          instanceId: layout.instanceId,
          label: macro.label,
          icon: macro.icon,
          color: macro.color,
          type: macro.type,
          config: macro.config,
          sortOrder: index,
          updatedAt: now,
        });
        macrosInserted++;
      }
    }

    return { layoutsScanned: layouts.length, instancesSeeded: seededInstances.size, macrosInserted, skipped };
  },
});

type LegacyMacro = {
  label: string;
  icon?: string;
  color?: string;
  type: "chat-command" | "trigger-workflow" | "http-request";
  config: Record<string, unknown>;
};

const MACRO_TYPES = new Set(["chat-command", "trigger-workflow", "http-request"]);

/** Every macro across a layout row's panels, in placement order. */
function collectMacros(layout: Doc<"dashboardLayouts">): LegacyMacro[] {
  const out: LegacyMacro[] = [];
  for (const panel of layout.panels ?? []) {
    for (const widget of panel.widgets) {
      if (widget.type !== "macro-pad") {
        continue;
      }
      const raw = (widget.config as { macros?: unknown } | undefined)?.macros;
      if (!Array.isArray(raw)) {
        continue;
      }
      for (const entry of raw) {
        const macro = parseMacro(entry);
        if (macro) {
          out.push(macro);
        }
      }
    }
  }
  return out;
}

// The blob was `v.any()`, so nothing guaranteed its shape — anything that does
// not parse is dropped rather than inserted as a broken row.
function parseMacro(entry: unknown): LegacyMacro | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.label !== "string" || !record.label.trim()) {
    return null;
  }
  if (typeof record.type !== "string" || !MACRO_TYPES.has(record.type)) {
    return null;
  }
  return {
    label: record.label,
    icon: typeof record.icon === "string" ? record.icon : undefined,
    color: typeof record.color === "string" ? record.color : undefined,
    type: record.type as LegacyMacro["type"],
    config: record.config && typeof record.config === "object" ? (record.config as Record<string, unknown>) : {},
  };
}
