import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { useInstance } from "@/hooks/use-instance";
import type { ActionObject, ActionObjectTarget, ObjectInstance, ObjectInstancesByKey } from "@/lib/action-objects";
import { sceneChoices } from "@/lib/scene-field-options";

/**
 * The streamer's own things each object's "Which one?" offers, by object key, from
 * the same queries the settings form's pickers read, so a chip stores the value
 * that form would: a resource instance's canonical id (`moduleResourceInstances.
 * listByKind`), a scene's engine id (`scenes.list`), an alert widget's name
 * (`sceneWidgets.alertWidgetNames`). `undefined` while a list loads.
 *
 * A query runs only when some object in `objects` needs it.
 */
export function useActionObjectInstances(objects: readonly ActionObject[]): ObjectInstancesByKey {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const needs = (target: ActionObjectTarget) => objects.some((object) => sameTarget(object.target, target));

  // One query per kind in RESOURCE_OBJECT_KINDS (action-objects.ts); hooks cannot run in a loop.
  const counters = useResourceInstances(instanceId, COUNTER_KIND, needs({ type: "resource", kind: COUNTER_KIND }));
  const timers = useResourceInstances(instanceId, TIMER_KIND, needs({ type: "resource", kind: TIMER_KIND }));
  const queues = useResourceInstances(instanceId, QUEUE_KIND, needs({ type: "resource", kind: QUEUE_KIND }));
  const scenes = useQuery(
    api.scenes.list,
    instanceId && needs({ type: "source", source: "scenes" }) ? { instanceId } : "skip"
  );
  const alertWidgetNames = useQuery(
    api.sceneWidgets.alertWidgetNames,
    instanceId && needs({ type: "source", source: "alertWidgets" }) ? { instanceId } : "skip"
  );

  return useMemo(() => {
    const byTarget = (target: ActionObjectTarget): readonly ObjectInstance[] | undefined => {
      if (target.type === "source") {
        if (target.source === "scenes") {
          return scenes === undefined ? undefined : sceneChoices(scenes);
        }
        return alertWidgetNames?.map((name) => ({ value: name, label: name }));
      }
      if (target.kind === COUNTER_KIND) {
        return counters;
      }
      if (target.kind === TIMER_KIND) {
        return timers;
      }
      if (target.kind === QUEUE_KIND) {
        return queues;
      }
      return [];
    };
    const result = new Map<string, readonly ObjectInstance[] | undefined>();
    for (const object of objects) {
      if (object.target) {
        result.set(object.key, byTarget(object.target));
      }
    }
    return result;
  }, [objects, counters, timers, queues, scenes, alertWidgetNames]);
}

function useResourceInstances(
  instanceId: Id<"instances"> | undefined,
  kind: string,
  wanted: boolean
): ObjectInstance[] | undefined {
  const rows = useQuery(api.moduleResourceInstances.listByKind, instanceId && wanted ? { instanceId, kind } : "skip");
  return useMemo(
    () =>
      rows
        ?.map((row) => ({ value: row.canonicalId, label: row.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rows]
  );
}

function sameTarget(a: ActionObjectTarget | undefined, b: ActionObjectTarget): boolean {
  if (!a || a.type !== b.type) {
    return false;
  }
  if (a.type === "resource" && b.type === "resource") {
    return a.kind === b.kind;
  }
  return a.type === "source" && b.type === "source" && a.source === b.source;
}
