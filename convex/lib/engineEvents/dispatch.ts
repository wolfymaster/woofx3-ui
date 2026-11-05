import { escapeDollarKeys } from "@shared/dollar-keys";
import { canonicalIdForStorageKey } from "@shared/resource-values";
import { readWidgetBehaviorKinds } from "@shared/widget-behavior-kinds";
import { widgetCanonicalKey } from "@shared/widget-key";
import { WORKFLOW_HEALTH_CHANGED_EVENT_TYPE, WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE } from "@shared/workflow-health";
import { WORKFLOW_RUN_CANCELLED_EVENT_TYPE } from "@shared/workflow-test-run";
import type { CallbackEnvelope, CallbackEvent, WorkflowRunCancelledEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { clearOverlayUrlForToken } from "../../browserSource";
import {
  addGroupMemberFromWebhook,
  deleteGroupFromWebhook,
  removeGroupMemberFromWebhook,
  upsertGroupFromWebhook,
} from "../../chatCommandGroups";
import { deleteCommandFromWebhook, upsertCommandFromWebhook } from "../../chatCommands";
import { mergeEngineAlert } from "../../engineAlerts";
import { applySessionStarted, applyStreamOffline, applyStreamOnline } from "../../instanceLiveState";
import { logger } from "../../logger";
import { deleteModuleAssetsFromWebhook, upsertModuleAssetsFromWebhook } from "../../moduleAssets";
import { deleteModuleFunctionsFromWebhook, upsertModuleFunctionsFromWebhook } from "../../moduleFunctions";
import { deleteResourceInstanceFromWebhook, upsertResourceInstanceFromWebhook } from "../../moduleResourceInstances";
import {
  applyDeregisteredDefinitions,
  applyModuleDeleted,
  applyModuleDeleteFailed,
  applyModuleInstalled,
  applyModuleInstallFailed,
  applyRegisteredDefinitions,
} from "../../moduleWebhook";
import { registerWidgetFromWebhook, unregisterWidget } from "../../moduleWidgets";
import { upsertValue } from "../../resourceValues";
import { deleteSceneFromWebhook, upsertSceneFromWebhook } from "../../scenes";
import { upsertSessionSummaryFromWebhook } from "../../streamSessionSummaries";
import { emitTransientEvent } from "../../transientEvents";
import { applyDatabaseRecordChange } from "../../userPageDatabases";
import { deleteWorkflowGroupFromWebhook, upsertWorkflowGroupFromWebhook } from "../../workflowGroups";
import { recordWorkflowHealthChange, recordWorkflowHealthSnapshot } from "../../workflowHealth";
import {
  deleteWorkflowFromWebhook,
  resolveWorkflowCorrelation,
  resolveWorkflowDeleteCorrelation,
  upsertWorkflowFromWebhook,
} from "../../workflowInternal";
import { recordRunFromWebhook, recordRunStepFromWebhook, updateRunFromWebhook } from "../../workflowRuns";
import { ALERT_PLAYING_EVENT_TYPE, readAlertSnapshot } from "../engineAlertLifecycle";
import { SESSION_SUMMARY_EVENT_TYPE } from "../sessionSummary";
import {
  engineResponseTransient,
  runLifecycleTransient,
  storageChangedTransient,
  widgetStatusTransient,
} from "../webhookTransients";

/**
 * What applying one engine event did. `invalid` is an event Convex can never
 * apply (the legacy route answers it 400 so the engine does not retry); a
 * failure while applying throws instead, so the caller's transaction aborts
 * and nothing of the event is half-written.
 */
export type EngineEventOutcome = { kind: "applied" } | { kind: "ignored" } | { kind: "invalid"; reason: string };

const APPLIED: EngineEventOutcome = { kind: "applied" };
const IGNORED: EngineEventOutcome = { kind: "ignored" };

/** Callbacks that carry an engine alert snapshot to merge into `engineAlerts`. */
const ALERT_SNAPSHOT_EVENT_TYPES: ReadonlySet<string> = new Set([
  EngineEventType.ALERT_RECORDED,
  ALERT_PLAYING_EVENT_TYPE,
  EngineEventType.ALERT_REPLAYED,
  EngineEventType.ALERT_COMPLETED,
  EngineEventType.ALERT_FAILED,
  EngineEventType.ALERT_TIMED_OUT,
  EngineEventType.ALERT_SKIPPED,
]);

/**
 * A field newer engines send and older ones leave out. Typed as a string by
 * the shared event types, but read defensively: the documents take a string
 * or nothing, never null.
 */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Applies one engine event (not a request) to this instance's documents, in
 * the caller's transaction. Every write of the event happens here or not at
 * all: nothing is caught and carried on from, since Convex has no savepoints
 * and a caught failure would leave the event half-applied.
 */
export async function applyEngineEvent(
  ctx: MutationCtx,
  instance: Doc<"instances">,
  envelope: CallbackEnvelope
): Promise<EngineEventOutcome> {
  const instanceId = instance._id;
  // The engine embeds `$ref` inside workflow definitions, and Convex rejects
  // `$`-prefixed field names.
  const event = escapeDollarKeys(envelope.data) as CallbackEvent | undefined;
  if (!event || typeof event !== "object" || !event.type) {
    logger.warn("engine event: envelope missing typed data", { instanceId, eventType: envelope.type });
    return IGNORED;
  }
  const eventType: string = event.type;

  // The types below are handled ahead of the switch because the engine types
  // this repo builds against may predate them, so they cannot be cases of the
  // CallbackEvent union. Their bodies are validated field by field instead.
  if (eventType === SESSION_SUMMARY_EVENT_TYPE) {
    const result = await upsertSessionSummaryFromWebhook(ctx, { instanceId, data: event });
    return result.outcome === "invalid"
      ? { kind: "invalid", reason: `Invalid session summary: ${result.reason}` }
      : APPLIED;
  }

  if (eventType === WORKFLOW_HEALTH_CHANGED_EVENT_TYPE || eventType === WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE) {
    const result =
      eventType === WORKFLOW_HEALTH_CHANGED_EVENT_TYPE
        ? await recordWorkflowHealthChange(ctx, { instanceId, data: event })
        : await recordWorkflowHealthSnapshot(ctx, { instanceId, data: event });
    return result.outcome === "invalid"
      ? { kind: "invalid", reason: `Invalid workflow health: ${result.reason}` }
      : APPLIED;
  }

  // Written to transientEvents like the other workflow.run.* lifecycle events,
  // for a caller watching the run's triggerId; the history row settles
  // through WORKFLOW_RUN_UPDATED.
  if (eventType === WORKFLOW_RUN_CANCELLED_EVENT_TYPE) {
    const transient = runLifecycleTransient(event as unknown as WorkflowRunCancelledEvent);
    if (!transient) {
      return IGNORED;
    }
    await emitTransientEvent(ctx, { instanceId, ...transient });
    return APPLIED;
  }

  // Every alert callback carries a whole snapshot and merges the same way,
  // read through readAlertSnapshot so a field a newer engine adds does not
  // fail the write. A snapshot without an id or status can never be merged.
  if (ALERT_SNAPSHOT_EVENT_TYPES.has(eventType)) {
    const { snapshot, problems } = readAlertSnapshot((event as unknown as { alert?: unknown }).alert);
    if (!snapshot) {
      logger.warn("engine event: alert callback without a usable alert", { instanceId, eventType, problems });
      return { kind: "invalid", reason: "Alert callback needs an alert with an id and a status" };
    }
    if (problems.length > 0) {
      logger.warn("engine event: alert callback with unusable fields", {
        instanceId,
        eventType,
        alertId: snapshot.id,
        problems,
      });
    }
    await mergeEngineAlert(ctx, { instanceId, snapshot });
    return APPLIED;
  }

  switch (event.type) {
    case EngineEventType.MODULE_INSTALLED: {
      const moduleDbId = await applyModuleInstalled(ctx, {
        instanceId,
        correlationKey: event.moduleKey,
        moduleName: event.moduleName,
        moduleVersion: event.version,
        // module.installed carries no definitions; those arrive on separate
        // module.trigger.registered / module.action.registered events.
        triggers: [],
        actions: [],
      });
      // Neither install path (marketplace or direct zip upload) reliably has
      // the manifest in hand at this point, so the engine's authoritative copy
      // is fetched out of band.
      await ctx.scheduler.runAfter(0, internal.moduleManifestSync.syncManifest, {
        instanceId,
        moduleDbId,
        manifestModuleId: event.moduleKey.split(":")[0],
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_INSTALL_FAILED: {
      await applyModuleInstallFailed(ctx, {
        instanceId,
        correlationKey: event.moduleKey,
        moduleName: event.moduleName,
        moduleVersion: event.version,
        statusMessage: event.error || undefined,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_DELETED: {
      await applyModuleDeleted(ctx, {
        instanceId,
        correlationKey: event.moduleKey,
        moduleName: event.moduleName,
        moduleVersion: undefined,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_DELETE_FAILED: {
      await applyModuleDeleteFailed(ctx, {
        instanceId,
        correlationKey: event.moduleKey,
        moduleName: event.moduleName,
        moduleVersion: undefined,
        error: event.error || undefined,
        conflicts: event.inUseResources,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_TRIGGER_REGISTERED: {
      await applyRegisteredDefinitions(ctx, {
        instanceId,
        moduleName: event.moduleName,
        moduleVersion: event.version,
        triggers: event.triggers,
        actions: [],
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_ACTION_REGISTERED: {
      await applyRegisteredDefinitions(ctx, {
        instanceId,
        moduleName: event.moduleName,
        moduleVersion: event.version,
        triggers: [],
        actions: event.actions,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_WIDGET_REGISTERED: {
      // Upserts the widget definition and places it for this instance. Keyed
      // on the canonical projectionKey, not widget.id, which the engine omits
      // for built-ins.
      for (const widget of event.widgets) {
        const widgetId = widgetCanonicalKey({
          projectionKey: widget.projectionKey,
          createdByRef: widget.createdByRef,
          manifestId: widget.manifestId,
          canonicalId: widget.canonicalId,
          id: widget.id,
        });
        await registerWidgetFromWebhook(ctx, {
          instanceId,
          widgetId,
          name: widget.name ?? widgetId,
          directory: widget.directory ?? "",
          description: widget.description,
          createdByType: widget.createdByType,
          createdByRef: widget.createdByRef,
          projectionKey: widget.projectionKey,
          alertTypes: widget.alertTypes ?? [],
          // ConfigField[], the same shape a trigger's or action's fields use.
          settings: widget.settings,
          surfaces: widget.surfaces,
          hostsSurface: widget.hostsSurface,
          taxonomy: widget.taxonomy,
          behaviorKinds: readWidgetBehaviorKinds(widget.behaviorKinds),
        });
      }
      return APPLIED;
    }

    case EngineEventType.MODULE_WIDGET_DEREGISTERED: {
      for (const widget of event.widgets) {
        await unregisterWidget(ctx, {
          instanceId,
          widgetId: widgetCanonicalKey({
            projectionKey: widget.projectionKey,
            createdByRef: widget.createdByRef,
            manifestId: widget.manifestId,
            canonicalId: widget.canonicalId,
            id: widget.id,
          }),
        });
      }
      return APPLIED;
    }

    case EngineEventType.WORKFLOW_CREATED:
    case EngineEventType.WORKFLOW_UPDATED: {
      await upsertWorkflowFromWebhook(ctx, {
        instanceId,
        engineWorkflowId: event.workflow.id,
        definition: event.workflow.definition,
        isEnabled: event.workflow.isEnabled,
        revision: event.workflow.revision,
        groupIds: event.workflow.groupIds,
      });
      if (event.correlationKey) {
        await resolveWorkflowCorrelation(ctx, {
          correlationKey: event.correlationKey,
          engineWorkflowId: event.workflow.id,
          op: event.type === EngineEventType.WORKFLOW_CREATED ? "create" : "update",
        });
      }
      return APPLIED;
    }

    case EngineEventType.WORKFLOW_DELETED: {
      await deleteWorkflowFromWebhook(ctx, {
        instanceId,
        engineWorkflowId: event.workflowId,
        mergedInto: event.mergedInto,
      });
      if (event.correlationKey) {
        await resolveWorkflowDeleteCorrelation(ctx, {
          correlationKey: event.correlationKey,
          engineWorkflowId: event.workflowId,
        });
      }
      return APPLIED;
    }

    case EngineEventType.WORKFLOW_GROUP_CREATED:
    case EngineEventType.WORKFLOW_GROUP_UPDATED: {
      await upsertWorkflowGroupFromWebhook(ctx, {
        instanceId,
        engineGroupId: event.group.id,
        name: event.group.name,
        description: event.group.description,
        enabled: event.group.enabled,
        memberIds: event.group.memberIds,
      });
      return APPLIED;
    }

    case EngineEventType.WORKFLOW_GROUP_DELETED: {
      await deleteWorkflowGroupFromWebhook(ctx, { instanceId, engineGroupId: event.groupId });
      return APPLIED;
    }

    case EngineEventType.SCENE_CREATED:
    case EngineEventType.SCENE_UPDATED: {
      await upsertSceneFromWebhook(ctx, {
        instanceId,
        engineSceneId: event.scene.id,
        kind: optionalString(event.scene.kind),
        name: event.scene.name,
        description: event.scene.description,
        widgetsJson: event.scene.widgetsJson,
        layoutJson: event.scene.layoutJson,
        behaviorsJson: optionalString(event.scene.behaviorsJson),
        inputsJson: optionalString(event.scene.inputsJson),
        createdByType: event.scene.createdByType,
        createdByRef: event.scene.createdByRef,
        createdAt: event.scene.createdAt,
        updatedAt: event.scene.updatedAt,
      });
      return APPLIED;
    }

    case EngineEventType.SCENE_DELETED: {
      await deleteSceneFromWebhook(ctx, {
        instanceId,
        engineSceneId: event.sceneId,
        kind: optionalString(event.kind),
      });
      return APPLIED;
    }

    case EngineEventType.COMMAND_CREATED:
    case EngineEventType.COMMAND_UPDATED: {
      await upsertCommandFromWebhook(ctx, {
        instanceId,
        engineCommandId: event.command.id,
        command: event.command.command,
        // Already `$`-escaped with the rest of the event above.
        actions: event.command.actions ?? [],
        engineWorkflowId: event.command.workflowId ?? "",
        workflowError: event.command.workflowError ?? "",
        steps: (event.command.steps ?? []) as unknown[],
        cooldown: event.command.cooldown,
        priority: event.command.priority,
        enabled: event.command.enabled,
        visibility: event.command.visibility,
        groupIds: event.command.groupIds ?? [],
        usernames: event.command.usernames ?? [],
        argumentPattern: event.command.argumentPattern ?? "",
      });
      return APPLIED;
    }

    case EngineEventType.COMMAND_DELETED: {
      await deleteCommandFromWebhook(ctx, { instanceId, engineCommandId: event.commandId });
      return APPLIED;
    }

    case EngineEventType.GROUP_CREATED:
    case EngineEventType.GROUP_UPDATED: {
      await upsertGroupFromWebhook(ctx, {
        instanceId,
        engineGroupId: event.group.id,
        name: event.group.name,
        description: event.group.description,
        isBuiltIn: event.group.isBuiltIn,
        engineCreatedAt: event.group.createdAt,
      });
      return APPLIED;
    }

    case EngineEventType.GROUP_DELETED: {
      await deleteGroupFromWebhook(ctx, { instanceId, engineGroupId: event.groupId });
      return APPLIED;
    }

    case EngineEventType.GROUP_MEMBER_ADDED: {
      await addGroupMemberFromWebhook(ctx, { instanceId, engineGroupId: event.groupId, username: event.username });
      return APPLIED;
    }

    case EngineEventType.GROUP_MEMBER_REMOVED: {
      await removeGroupMemberFromWebhook(ctx, { instanceId, engineGroupId: event.groupId, username: event.username });
      return APPLIED;
    }

    case EngineEventType.MODULE_TRIGGER_DEREGISTERED: {
      await applyDeregisteredDefinitions(ctx, { instanceId, triggers: event.triggers, actions: [] });
      return APPLIED;
    }

    case EngineEventType.MODULE_ACTION_DEREGISTERED: {
      await applyDeregisteredDefinitions(ctx, { instanceId, triggers: [], actions: event.actions });
      return APPLIED;
    }

    case EngineEventType.MODULE_FUNCTION_REGISTERED: {
      await upsertModuleFunctionsFromWebhook(ctx, {
        instanceId,
        moduleKey: event.moduleKey,
        moduleName: event.moduleName,
        version: event.version,
        functions: event.functions,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_FUNCTION_DEREGISTERED: {
      await deleteModuleFunctionsFromWebhook(ctx, { instanceId, functions: event.functions });
      return APPLIED;
    }

    case EngineEventType.MODULE_ASSET_REGISTERED: {
      await upsertModuleAssetsFromWebhook(ctx, {
        instanceId,
        moduleKey: event.moduleKey,
        moduleName: event.moduleName,
        version: event.version,
        assets: event.assets,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_ASSET_DEREGISTERED: {
      await deleteModuleAssetsFromWebhook(ctx, {
        instanceId,
        moduleKey: event.moduleKey,
        moduleName: event.moduleName,
        version: event.version,
        assets: event.assets,
      });
      return APPLIED;
    }

    case EngineEventType.MODULE_RESOURCE_INSTANCE_UPDATED:
    case EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED: {
      await upsertResourceInstanceFromWebhook(ctx, { instanceId, instance: event.instance });
      return APPLIED;
    }

    case EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED: {
      await deleteResourceInstanceFromWebhook(ctx, { instanceId, instance: event.instance });
      return APPLIED;
    }

    case EngineEventType.MODULE_STORAGE_CHANGED: {
      const canonicalId = canonicalIdForStorageKey(event.key);
      if (canonicalId) {
        await upsertValue(ctx, instanceId, canonicalId, event.value ?? null);
      }
      await emitTransientEvent(ctx, { instanceId, ...storageChangedTransient(event) });
      return APPLIED;
    }

    case EngineEventType.DATABASE_RECORD_CHANGED: {
      await applyDatabaseRecordChange(ctx, {
        instanceId,
        change: {
          databaseId: event.databaseId,
          recordId: event.recordId,
          op: event.op,
          revision: event.revision,
          createdAt: event.createdAt,
          publicValues: event.publicValues,
        },
      });
      return APPLIED;
    }

    case EngineEventType.ENGINE_RESPONSE_RECEIVED: {
      await emitTransientEvent(ctx, { instanceId, ...engineResponseTransient(event) });
      return APPLIED;
    }

    // A workflow run somebody is waiting on. transientEvents is keyed by the
    // client-generated id the trigger carried, so the UI subscribes before the
    // run exists.
    case EngineEventType.WORKFLOW_RUN_STARTED:
    case EngineEventType.WORKFLOW_RUN_COMPLETED:
    case EngineEventType.WORKFLOW_RUN_FAILED: {
      const transient = runLifecycleTransient(event);
      if (!transient) {
        // Nothing to correlate it to: a row under an undefined key would sit
        // where no subscriber looks.
        return IGNORED;
      }
      await emitTransientEvent(ctx, { instanceId, ...transient });
      return APPLIED;
    }

    // Durable run history, unlike the transient lifecycle rows above.
    case EngineEventType.WORKFLOW_RUN_RECORDED: {
      await recordRunFromWebhook(ctx, { instanceId, run: event.run });
      return APPLIED;
    }

    case EngineEventType.WORKFLOW_RUN_UPDATED: {
      await updateRunFromWebhook(ctx, { instanceId, run: event.run });
      return APPLIED;
    }

    case EngineEventType.WORKFLOW_RUN_STEP_RECORDED: {
      await recordRunStepFromWebhook(ctx, { instanceId, step: event.step });
      return APPLIED;
    }

    case EngineEventType.WIDGET_STATUS_CHANGED: {
      await emitTransientEvent(ctx, { instanceId, ...widgetStatusTransient(event) });
      return APPLIED;
    }

    case EngineEventType.OVERLAY_TOKEN_REVOKED: {
      // Best-effort cache invalidation for a token revoked through some other
      // channel; this app's own revoke and rotate keep the cache correct.
      await clearOverlayUrlForToken(ctx, { engineTokenId: event.tokenId });
      return APPLIED;
    }

    case EngineEventType.STREAM_ONLINE: {
      await applyStreamOnline(ctx, {
        instanceId,
        twitchUserId: event.twitchUserId,
        startedAt: event.startedAt,
        streamTitle: event.streamTitle,
        gameName: event.gameName,
        viewerCount: event.viewerCount,
      });
      return APPLIED;
    }

    case EngineEventType.STREAM_OFFLINE: {
      await applyStreamOffline(ctx, { instanceId, twitchUserId: event.twitchUserId });
      return APPLIED;
    }

    case EngineEventType.SESSION_STARTED: {
      await applySessionStarted(ctx, {
        instanceId,
        sessionId: event.sessionId,
        sessionStartedAt: event.startedAt,
      });
      return APPLIED;
    }

    default: {
      logger.warn("engine event: unhandled event type", { instanceId, eventType });
      return IGNORED;
    }
  }
}
