import type { ConfigField } from "@woofx3/api/ui-schema";
import { useEffect, useRef, useState } from "react";
import { ConditionValueEditor, type LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { Button } from "@/components/ui/button";
import type { SentencePart } from "@/lib/condition-sentence";
import { cn } from "@/lib/utils";
import type { TriggerConfigValues } from "@/lib/workflow-presets";

interface TriggerWhenCardProps {
  /** The trigger's sentence: the event, with a value for each condition. */
  parts: SentencePart[];
  /** The fields the sentence may change; a field held by the page reads as plain text. */
  editableFields: ConfigField[];
  values: TriggerConfigValues;
  loadedOptions: ReadonlyMap<string, LoadedFieldOptions>;
  onChangeValue: (fieldId: string, value: unknown) => void;
  /** What the card reads when the trigger has no sentence: no conditions and no template. */
  fallback: string;
  /** A field editor closed, so the values it changed are settled and can be saved. */
  onSettle: () => void;
}

/**
 * The "When" part of an alert's sentence. Each condition value is a phrase; opening one
 * expands its editor directly beneath the sentence, in the document flow. No popover, no
 * card of its own — the sentence is the control, and the page grows taller as it is used.
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
  const sectionRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const openField = openFieldId === null ? undefined : editableFields.find((field) => field.id === openFieldId);

  useEffect(() => {
    if (openFieldId === null) {
      return;
    }
    sectionRef.current?.querySelector<HTMLElement>("input, button, [tabindex]:not([tabindex='-1'])")?.focus();
  }, [openFieldId]);

  const close = () => {
    if (openFieldId === null) {
      return;
    }
    buttons.current.get(openFieldId)?.focus();
    setOpenFieldId(null);
    onSettle();
  };

  return (
    <>
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1" data-testid="trigger-when-card">
        <span className="text-muted-foreground">When</span>
        {parts.length === 0 ? (
          <span className="font-medium">{fallback}</span>
        ) : (
          parts.map((part, index) => {
            const key = `${index}-${part.kind === "field" ? part.fieldId : part.text}`;
            if (part.kind === "text") {
              return <span key={key}>{part.text}</span>;
            }
            const editable = editableFields.some((field) => field.id === part.fieldId);
            if (!editable) {
              return (
                <span key={key} className="font-medium text-primary-text">
                  {part.text}
                </span>
              );
            }
            const open = openFieldId === part.fieldId;
            return (
              <button
                key={key}
                ref={(node) => {
                  if (node) {
                    buttons.current.set(part.fieldId, node);
                  } else {
                    buttons.current.delete(part.fieldId);
                  }
                }}
                type="button"
                className={cn(
                  "phrase inline-block rounded-md px-1 font-medium",
                  open && "phrase-open",
                  part.state === "missing" ? "text-amber-600 dark:text-amber-300" : "text-primary-text"
                )}
                aria-expanded={open}
                aria-label={`${part.text}. Change`}
                onClick={() => (open ? close() : setOpenFieldId(part.fieldId))}
                data-testid={`condition-value-${part.fieldId}`}
              >
                {part.text}
              </button>
            );
          })
        )}
      </span>
      {openField && (
        <div ref={sectionRef} className="phrase-section w-full" data-testid="when-field-section">
          <div className="mb-2 text-[13px] font-medium">{openField.label}</div>
          <ConditionValueEditor
            field={openField}
            value={values[openField.id]}
            loaded={loadedOptions.get(openField.id)}
            onChange={(value) => onChangeValue(openField.id, value)}
            onChosen={close}
          />
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={close} data-testid="when-field-done">
              Done
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
