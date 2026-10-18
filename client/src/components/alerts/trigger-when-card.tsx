import type { ConfigField } from "@woofx3/api/ui-schema";
import { useState } from "react";
import { ConditionSentence, type LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import type { SentencePart } from "@/lib/condition-sentence";
import type { TriggerConfigValues } from "@/lib/workflow-presets";

interface TriggerWhenCardProps {
  /** The trigger's sentence: the event, with a button for each condition value. */
  parts: SentencePart[];
  /** The fields the sentence may change; a field held by the page reads as plain text. */
  editableFields: ConfigField[];
  values: TriggerConfigValues;
  loadedOptions: ReadonlyMap<string, LoadedFieldOptions>;
  onChangeValue: (fieldId: string, value: unknown) => void;
  /** What the card reads when the trigger has no sentence: no conditions and no template. */
  fallback: string;
  /** A picker closed, so the values it changed are settled and can be saved. */
  onSettle: () => void;
}

/**
 * The "When" card of an alert trigger's step editor: the trigger's sentence, which both
 * says what it waits for and is where its conditions change — each value opens its own
 * picker. It stands in for the step editor's own When card, whose event never changes
 * here: a trigger belongs to the event it is listed under.
 */
export function TriggerWhenCard({
  parts,
  editableFields,
  values,
  loadedOptions,
  onChangeValue,
  onSettle,
  fallback,
}: TriggerWhenCardProps) {
  const [openFieldId, setOpenFieldId] = useState<string | null>(null);
  return (
    <section
      aria-label="When this runs"
      className="mb-2 flex flex-wrap items-baseline gap-3 rounded-xl border bg-card px-4 py-3.5 text-card-foreground"
      data-testid="trigger-when-card"
    >
      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">When</span>
      {parts.length === 0 ? (
        <span className="text-base font-medium leading-snug">{fallback}</span>
      ) : (
        <ConditionSentence
          parts={parts}
          fields={editableFields}
          values={values}
          loadedOptions={loadedOptions}
          openFieldId={openFieldId}
          onOpenFieldChange={(fieldId) => {
            setOpenFieldId(fieldId);
            if (fieldId === null) {
              onSettle();
            }
          }}
          onChangeValue={onChangeValue}
        />
      )}
    </section>
  );
}
