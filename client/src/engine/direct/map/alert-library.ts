import { escapeDollarKeys } from "@shared/dollar-keys";
import {
  parseCompositionInputs,
  parseSceneBehaviors,
  parseSceneLayout,
  parseSceneWidgets,
} from "@shared/scene-serialization";
import type { AlertComposition as EngineAlertComposition } from "@woofx3/api";
import type { AlertComposition } from "@/engine/types";

/**
 * A library alert as the gateway contract holds it: the stored JSON parsed
 * the way the Convex cache parses it, with `$` keys escaped (an alert refers
 * to its inputs as `{ "$input": id }`), so a screen reads one shape whichever
 * gateway served it.
 */
export function toAlertComposition(composition: EngineAlertComposition): AlertComposition {
  return {
    engineCompositionId: composition.id,
    name: composition.name,
    description: composition.description || undefined,
    widgets: escapeDollarKeys(parseSceneWidgets(composition.widgetsJson)) as unknown[],
    layout: escapeDollarKeys(parseSceneLayout(composition.layoutJson)),
    behaviors: escapeDollarKeys(parseSceneBehaviors(composition.behaviorsJson)),
    inputs: escapeDollarKeys(parseCompositionInputs(composition.inputsJson)) as unknown[],
    createdByType: composition.createdByType,
    createdByRef: composition.createdByRef,
  };
}
