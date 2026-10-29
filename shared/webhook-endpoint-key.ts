export type WebhookEndpointKey = {
  /** The trigger's canonical id, `{modulePrefix}:trigger:{triggerManifestId}`. */
  triggerKey: string;
  modulePrefix: string;
  triggerManifestId: string;
};

/**
 * Whether a trigger definition is a webhook trigger: fired by inbound HTTP
 * through its module's handler, never offered in the workflow builder.
 * Recognized by `transport`, or by its reserved `webhook.` event for engines
 * that predate the field.
 */
export function isWebhookTrigger(trigger: { transport?: string; event?: string }): boolean {
  return trigger.transport === "webhook" || (trigger.event ?? "").startsWith("webhook.");
}

/**
 * The endpoint identity of a trigger definition, or null when it is not a
 * webhook trigger or carries no projectionKey to key an endpoint by.
 */
export function webhookEndpointKey(trigger: {
  transport?: string;
  event?: string;
  projectionKey?: string;
}): WebhookEndpointKey | null {
  if (!isWebhookTrigger(trigger) || !trigger.projectionKey) {
    return null;
  }
  const [modulePrefix, kind, triggerManifestId, ...rest] = trigger.projectionKey.split(":");
  if (!modulePrefix || kind !== "trigger" || !triggerManifestId || rest.length > 0) {
    return null;
  }
  return { triggerKey: trigger.projectionKey, modulePrefix, triggerManifestId };
}

/**
 * The endpoint identities of a trigger list's webhook triggers. `complete` is
 * false when some webhook trigger in the list cannot be keyed: the list then
 * cannot say which endpoints are gone.
 */
export function webhookEndpointKeys(triggers: { transport?: string; event?: string; projectionKey?: string }[]): {
  keys: WebhookEndpointKey[];
  complete: boolean;
} {
  const keys: WebhookEndpointKey[] = [];
  let complete = true;
  for (const trigger of triggers) {
    if (!isWebhookTrigger(trigger)) {
      continue;
    }
    const key = webhookEndpointKey(trigger);
    if (key) {
      keys.push(key);
    } else {
      complete = false;
    }
  }
  return { keys, complete };
}
