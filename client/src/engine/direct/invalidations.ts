import type { QueryKey } from "@tanstack/react-query";
import { type CallbackEnvelope, type CallbackEventByType, EngineEventType } from "@woofx3/api";
import { directKeys as k } from "./keys";

type Invalidation<T extends EngineEventType> = (event: CallbackEventByType[T]) => readonly QueryKey[];

/** Nothing cached reads what the event reports. */
const NONE = (): readonly QueryKey[] => [];

const ALERT = (): readonly QueryKey[] => [k.alertQueue.all];
const LIVE_STATE = (): readonly QueryKey[] => [k.status.liveState()];
const COMMANDS = (): readonly QueryKey[] => [k.commands.list()];

/**
 * The cached reads each engine event may have made stale. Keyed by every
 * `EngineEventType`, so a type a newer engine contract adds fails the type
 * check here until someone decides what it invalidates; an empty answer says
 * so explicitly. Events that only feed transient events or pushes cache
 * nothing.
 */
export const INVALIDATIONS: { readonly [T in EngineEventType]: Invalidation<T> } = {
  [EngineEventType.MODULE_INSTALLED]: NONE,
  [EngineEventType.MODULE_INSTALL_FAILED]: NONE,
  [EngineEventType.MODULE_DELETED]: NONE,
  [EngineEventType.MODULE_DELETE_FAILED]: NONE,
  [EngineEventType.MODULE_TRIGGER_REGISTERED]: NONE,
  [EngineEventType.MODULE_ACTION_REGISTERED]: NONE,
  [EngineEventType.MODULE_FUNCTION_REGISTERED]: NONE,
  [EngineEventType.MODULE_WIDGET_REGISTERED]: NONE,
  [EngineEventType.MODULE_TRIGGER_DEREGISTERED]: NONE,
  [EngineEventType.MODULE_ACTION_DEREGISTERED]: NONE,
  [EngineEventType.MODULE_FUNCTION_DEREGISTERED]: NONE,
  [EngineEventType.MODULE_WIDGET_DEREGISTERED]: NONE,
  [EngineEventType.MODULE_ASSET_REGISTERED]: NONE,
  [EngineEventType.MODULE_ASSET_DEREGISTERED]: NONE,
  [EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED]: NONE,
  [EngineEventType.MODULE_RESOURCE_INSTANCE_UPDATED]: NONE,
  [EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED]: NONE,
  [EngineEventType.MODULE_STORAGE_CHANGED]: NONE,
  [EngineEventType.ENGINE_RESPONSE_RECEIVED]: NONE,
  [EngineEventType.WORKFLOW_CREATED]: NONE,
  [EngineEventType.WORKFLOW_UPDATED]: NONE,
  [EngineEventType.WORKFLOW_DELETED]: NONE,
  [EngineEventType.WORKFLOW_RUN_STARTED]: NONE,
  [EngineEventType.WORKFLOW_RUN_COMPLETED]: NONE,
  [EngineEventType.WORKFLOW_RUN_FAILED]: NONE,
  [EngineEventType.WORKFLOW_RUN_CANCELLED]: NONE,
  [EngineEventType.WORKFLOW_HEALTH_CHANGED]: NONE,
  [EngineEventType.WORKFLOW_HEALTH_SNAPSHOT]: NONE,
  [EngineEventType.WORKFLOW_RUN_RECORDED]: NONE,
  [EngineEventType.WORKFLOW_RUN_UPDATED]: NONE,
  [EngineEventType.WORKFLOW_RUN_STEP_RECORDED]: NONE,
  [EngineEventType.SCENE_CREATED]: NONE,
  [EngineEventType.SCENE_UPDATED]: NONE,
  [EngineEventType.SCENE_DELETED]: NONE,
  [EngineEventType.ALERT_RECORDED]: ALERT,
  [EngineEventType.ALERT_PLAYING]: ALERT,
  [EngineEventType.ALERT_REPLAYED]: ALERT,
  [EngineEventType.ALERT_COMPLETED]: ALERT,
  [EngineEventType.ALERT_FAILED]: ALERT,
  [EngineEventType.ALERT_TIMED_OUT]: ALERT,
  [EngineEventType.ALERT_SKIPPED]: ALERT,
  [EngineEventType.WIDGET_STATUS_CHANGED]: NONE,
  [EngineEventType.STREAM_ONLINE]: LIVE_STATE,
  [EngineEventType.STREAM_OFFLINE]: LIVE_STATE,
  [EngineEventType.SESSION_STARTED]: LIVE_STATE,
  [EngineEventType.SESSION_SUMMARY]: LIVE_STATE,
  [EngineEventType.OVERLAY_TOKEN_MINTED]: NONE,
  [EngineEventType.OVERLAY_TOKEN_REVOKED]: NONE,
  [EngineEventType.COMMAND_CREATED]: COMMANDS,
  [EngineEventType.COMMAND_UPDATED]: COMMANDS,
  [EngineEventType.COMMAND_DELETED]: COMMANDS,
  [EngineEventType.GROUP_CREATED]: () => [k.commands.groups()],
  [EngineEventType.GROUP_UPDATED]: () => [k.commands.groups()],
  [EngineEventType.GROUP_DELETED]: (event) => [k.commands.groups(), k.commands.members(event.groupId)],
  [EngineEventType.GROUP_MEMBER_ADDED]: (event) => [k.commands.members(event.groupId)],
  [EngineEventType.GROUP_MEMBER_REMOVED]: (event) => [k.commands.members(event.groupId)],
  [EngineEventType.UI_SETTING_CHANGED]: NONE,
  [EngineEventType.TWITCH_LINK_CHANGED]: NONE,
};

/**
 * The keys `envelope` makes stale. An event type this build does not know,
 * from a newer engine, is answered with every key, since nothing here can
 * say what it changed.
 */
export function invalidatedBy(envelope: CallbackEnvelope): readonly QueryKey[] | "everything" {
  if (!Object.hasOwn(INVALIDATIONS, envelope.type)) {
    return "everything";
  }
  const invalidate = INVALIDATIONS[envelope.type] as Invalidation<EngineEventType>;
  return invalidate(envelope.data as CallbackEventByType[EngineEventType]);
}
