import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  conditionFieldType,
  conditionValueProblem,
  conditionValueText,
  isValuelessOperator,
  parseConditionValue,
} from "@/lib/condition-value";
import type { VariableOption } from "@/lib/workflow-variables";

const OPERATORS: ConditionOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "exists",
  "not_exists",
  "regex",
  "between",
];

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "equals",
  ne: "not equals",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  in: "in (list)",
  not_in: "not in (list)",
  exists: "exists",
  not_exists: "does not exist",
  regex: "matches regex",
  between: "between (min, max)",
};

/**
 * The value input of one condition row. It keeps the text as typed, because the stored
 * value drops what does not change it: the trailing comma of a list being typed, the
 * "." of a decimal. The text shows only while it still reads as the stored value, so a
 * value replaced from outside, or a row taking the place of a removed one, shows the
 * stored value instead.
 */
function ConditionValueInput({
  index,
  operator,
  fieldType,
  value,
  onChange,
  availableVariables,
}: {
  index: number;
  operator: ConditionOperator;
  fieldType: string | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
  availableVariables: VariableOption[];
}) {
  const [draft, setDraft] = useState(() => conditionValueText(value));
  const draftIsCurrent = JSON.stringify(parseConditionValue(operator, draft, fieldType)) === JSON.stringify(value);
  const text = draftIsCurrent ? draft : conditionValueText(value);
  const problem = conditionValueProblem(operator, text);
  const problemId = useId();

  return (
    <div className="flex-1 space-y-1">
      <VariableAwareInput
        value={text}
        onChange={(raw) => {
          setDraft(raw);
          onChange(parseConditionValue(operator, raw, fieldType));
        }}
        placeholder={operator === "between" ? "min, max" : "value"}
        availableVariables={availableVariables}
        aria-describedby={problem ? problemId : undefined}
        data-testid={`input-condition-value-${index}`}
      />
      {problem && (
        <p id={problemId} className="text-xs text-destructive" data-testid={`text-condition-value-error-${index}`}>
          {problem}
        </p>
      )}
    </div>
  );
}

interface ConditionEditorProps {
  conditions: ConditionConfig[];
  onChange: (conditions: ConditionConfig[]) => void;
  addLabel?: string;
  /** Offered when the user types "{" in the field or value input — see computeAvailableVariables.
   * Empty is fine: the picker only opens when it has something to show, so the inputs stay plain text. */
  availableVariables?: VariableOption[];
}

/**
 * Freeform ConditionConfig[] editor — unlike manifest-schema-bound trigger
 * config fields, mid-workflow condition/wait steps evaluate arbitrary
 * `${...}` field paths against runtime context, so field/operator/value are
 * all plain user input here.
 */
export function ConditionEditor({
  conditions,
  onChange,
  addLabel = "Add condition",
  availableVariables = [],
}: ConditionEditorProps) {
  const updateRow = (index: number, patch: Partial<ConditionConfig>) => {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  // The field and operator decide how the value is typed, so changing either one
  // converts the value again from its text.
  const retypeRow = (index: number, field: string, operator: ConditionOperator) => {
    const fieldType = conditionFieldType(field, availableVariables);
    const text = conditionValueText(conditions[index].value);
    updateRow(index, { field, operator, value: parseConditionValue(operator, text, fieldType) });
  };

  const removeRow = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...conditions, { field: "", operator: "eq", value: "" }]);
  };

  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => {
        const hideValue = isValuelessOperator(condition.operator);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity; list is append/remove-only, not reordered
          <div key={index} className="flex items-start gap-2">
            <div className="flex-[1.2]">
              <VariableAwareInput
                value={condition.field}
                onChange={(field) => retypeRow(index, field, condition.operator)}
                placeholder="{variable}"
                className="font-mono text-xs"
                availableVariables={availableVariables}
                data-testid={`input-condition-field-${index}`}
              />
            </div>
            <Select
              value={condition.operator}
              onValueChange={(value) => retypeRow(index, condition.field, value as ConditionOperator)}
            >
              <SelectTrigger className="w-[168px] shrink-0" data-testid={`select-condition-operator-${index}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {OPERATOR_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!hideValue && (
              <ConditionValueInput
                index={index}
                operator={condition.operator}
                fieldType={conditionFieldType(condition.field, availableVariables)}
                value={condition.value}
                onChange={(value) => updateRow(index, { value })}
                availableVariables={availableVariables}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(index)}
              data-testid={`button-remove-condition-${index}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={addRow}
        data-testid="button-add-condition"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
