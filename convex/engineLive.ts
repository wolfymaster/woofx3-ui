import type {
  DatabaseRecordCreate,
  DatabaseRecordsQuery,
  DatabaseRecordUpdate,
  EventLogQuery,
  EventLogSelection,
} from "@woofx3/api";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { instanceEngine } from "./lib/instanceEngine";

// What the dashboard asks of its engine while it is open. The browser never
// speaks to the engine itself (it holds no engine credentials), so each call
// is an action: the viewer's role is checked, then Convex calls the engine as
// the instance. Payloads are `v.any()` because the engine validates its own
// inputs at its boundary; Convex only carries them.
//
// Reading is for any member; changing content is too, as everywhere else on
// an instance (see lib/instanceRoles.ts).

const instanceArgs = { instanceId: v.id("instances") };

/** Whether the engine answers; the dashboard's connected indicator and its gates read this. */
export const health = action({
  args: instanceArgs,
  handler: async (ctx, { instanceId }): Promise<{ connected: boolean }> => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    try {
      await engine.session().ping();
      return { connected: true };
    } catch {
      // Unreachable is the answer being asked for, not a failure of this call.
      return { connected: false };
    }
  },
});

export const listEvents = action({
  args: { ...instanceArgs, query: v.optional(v.any()) },
  handler: async (ctx, { instanceId, query }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().listEvents(query as EventLogQuery | undefined);
  },
});

export const getEventLogSettings = action({
  args: instanceArgs,
  handler: async (ctx, { instanceId }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().getEventLogSettings();
  },
});

export const setEventLogSelection = action({
  args: { ...instanceArgs, selection: v.any() },
  handler: async (ctx, { instanceId, selection }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().setEventLogSelection(selection as EventLogSelection);
  },
});

export const workflowRuns = action({
  args: instanceArgs,
  handler: async (ctx, { instanceId }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().getWorkflowRuns();
  },
});

export const listDatabaseRecords = action({
  args: { ...instanceArgs, query: v.any() },
  handler: async (ctx, { instanceId, query }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().listDatabaseRecords(query as DatabaseRecordsQuery);
  },
});

export const getDatabaseRecord = action({
  args: { ...instanceArgs, databaseId: v.string(), recordId: v.string() },
  handler: async (ctx, { instanceId, databaseId, recordId }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().getDatabaseRecord(databaseId, recordId);
  },
});

export const createDatabaseRecord = action({
  args: { ...instanceArgs, create: v.any() },
  handler: async (ctx, { instanceId, create }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().createDatabaseRecord(create as DatabaseRecordCreate);
  },
});

export const updateDatabaseRecord = action({
  args: { ...instanceArgs, update: v.any() },
  handler: async (ctx, { instanceId, update }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().updateDatabaseRecord(update as DatabaseRecordUpdate);
  },
});

export const deleteDatabaseRecord = action({
  args: { ...instanceArgs, databaseId: v.string(), recordId: v.string() },
  handler: async (ctx, { instanceId, databaseId, recordId }) => {
    const engine = await instanceEngine(ctx, instanceId, "member");
    return engine.session().deleteDatabaseRecord(databaseId, recordId);
  },
});
