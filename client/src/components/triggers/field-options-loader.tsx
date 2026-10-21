import type { ConfigField, InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { useEffect } from "react";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { useEngineScope } from "@/engine/context";
import { useFieldOptions } from "@/hooks/use-field-options";

/** Loads one runtime option list (a reward catalog) once for the whole page, and reports it up. */
export function FieldOptionsLoader({
  field,
  onLoaded,
}: {
  field: ConfigField;
  onLoaded: (fieldId: string, entry: LoadedFieldOptions) => void;
}) {
  const { instanceId } = useEngineScope();
  const { options, loading, error } = useFieldOptions(instanceId, field.source as InternalConfigFieldSource);
  useEffect(() => {
    onLoaded(field.id, { options, loading, error });
  }, [field.id, options, loading, error, onLoaded]);
  return null;
}
