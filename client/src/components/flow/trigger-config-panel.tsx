import type { ConditionConfig } from "@woofx3/api";
import { useMemo, useState } from "react";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { fieldOptionsOwnerFromCanonicalId, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { parseConfigFields, withModuleName } from "@/lib/parse-config-fields";
import { resolveCatalogTrigger } from "@/lib/workflow-node-label";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import {
  conditionsToFieldValues,
  fieldValuesToConditions,
  incompleteConditionFields,
} from "@/lib/workflow-presets-json";
import type { TriggerNode } from "@/lib/workflow-tree";

/**
 * A trigger's settings as a form, saved as its conditions. A setting left empty is held
 * back rather than saved, since saving it would quietly turn it into Any.
 */
export function TriggerConfigPanel({
  node,
  catalog,
  onUpdateTriggerConditions,
}: {
  node: TriggerNode;
  catalog: CatalogTriggerRow[];
  onUpdateTriggerConditions: (conditions: ConditionConfig[]) => void;
}) {
  // Values with a field left empty have no condition form yet, so they are held here
  // until finished; saving them would quietly turn the empty field into Any.
  const [unfinished, setUnfinished] = useState<TriggerConfigValues | null>(null);
  const catalogRow = resolveCatalogTrigger(node, catalog);
  const configFields = catalogRow?.configFields;
  const moduleName = catalogRow?.moduleName;
  const canonicalRef = catalogRow?.canonicalRef;
  const fields = useMemo(
    () =>
      withFieldOptionsOwner(
        withModuleName(parseConfigFields(configFields), moduleName),
        fieldOptionsOwnerFromCanonicalId(canonicalRef)
      ),
    [configFields, moduleName, canonicalRef]
  );
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">This trigger has no configurable settings.</p>;
  }
  const values = unfinished ?? conditionsToFieldValues(fields, node.conditions);
  return (
    <TriggerConfigForm
      fields={fields}
      values={values}
      onChange={(next) => {
        if (incompleteConditionFields(fields, next).length > 0) {
          setUnfinished(next);
          return;
        }
        setUnfinished(null);
        onUpdateTriggerConditions(fieldValuesToConditions(fields, next));
      }}
      allowAny
    />
  );
}
