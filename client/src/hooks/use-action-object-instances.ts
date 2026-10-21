import { useMemo } from "react";
import { useResourceInstancesOfKinds } from "@/engine/hooks/use-module-resources";
import { useAlertWidgetNames, useScenes } from "@/engine/hooks/use-scenes";
import {
  type ActionObject,
  type ObjectInstance,
  type ObjectInstancesByKey,
  type ResourceInstanceRow,
  resourceObjectInstances,
} from "@/lib/action-objects";
import { sceneChoices } from "@/lib/scene-field-options";

const NONE_CREATED: readonly ResourceInstanceRow[] = [];

/**
 * The streamer's own things each object's "Which one?" offers, by object key, from
 * the same data the settings form's pickers read, so a chip stores the value
 * that form would: a resource instance's canonical id, a scene's engine id
 * (`scenes.list`), an alert widget's name (`sceneWidgets.alertWidgetNames`).
 * `undefined` while a list loads.
 *
 * Resource instances come from one read (`useResourceInstancesOfKinds`) for
 * every kind any object's actions name, since which kinds those are depends
 * on the installed modules. `created` are instances made in the picker that the
 * mirror may not hold yet. A query runs only when some object needs it.
 */
export function useActionObjectInstances(
  objects: readonly ActionObject[],
  created: readonly ResourceInstanceRow[] = NONE_CREATED
): ObjectInstancesByKey {
  const kinds = useMemo(() => {
    const all = new Set<string>();
    for (const object of objects) {
      if (object.target?.type === "resource") {
        for (const kind of object.target.kinds) {
          all.add(kind);
        }
      }
    }
    return [...all].sort();
  }, [objects]);
  const needsSource = (source: "scenes" | "alertWidgets") =>
    objects.some((object) => object.target?.type === "source" && object.target.source === source);

  const resourceRows = useResourceInstancesOfKinds(kinds);
  const scenes = useScenes({ enabled: needsSource("scenes") });
  const alertWidgetNames = useAlertWidgetNames({ enabled: needsSource("alertWidgets") });

  return useMemo(() => {
    const result = new Map<string, readonly ObjectInstance[] | undefined>();
    for (const object of objects) {
      const target = object.target;
      if (!target) {
        continue;
      }
      if (target.type === "resource") {
        result.set(
          object.key,
          resourceRows === undefined ? undefined : resourceObjectInstances(object, [...resourceRows, ...created])
        );
      } else if (target.source === "scenes") {
        result.set(object.key, scenes === undefined ? undefined : sceneChoices(scenes));
      } else {
        result.set(
          object.key,
          alertWidgetNames?.map((name) => ({ value: name, label: name }))
        );
      }
    }
    return result;
  }, [objects, resourceRows, created, scenes, alertWidgetNames]);
}
