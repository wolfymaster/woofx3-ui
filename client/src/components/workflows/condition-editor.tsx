import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const LIST_OPERATORS = new Set<ConditionOperator>(["in", "not_in", "between"]);
const VALUELESS_OPERATORS = new Set<ConditionOperator>(["exists", "not_exists"]);

function valueToInputString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

function parseValueForOperator(operator: ConditionOperator, raw: string): unknown {
  if (VALUELESS_OPERATORS.has(operator)) {
    return undefined;
  }
  if (LIST_OPERATORS.has(operator)) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return raw;
}

interface ConditionEditorProps {
  conditions: ConditionConfig[];
  onChange: (conditions: ConditionConfig[]) => void;
  addLabel?: string;
}

/**
 * Freeform ConditionConfig[] editor — unlike manifest-schema-bound trigger
 * config fields, mid-workflow condition/wait steps evaluate arbitrary
 * `${...}` field paths against runtime context, so field/operator/value are
 * all plain user input here.
 */
export function ConditionEditor({ conditions, onChange, addLabel = "Add condition" }: ConditionEditorProps) {
  const updateRow = (index: number, patch: Partial<ConditionConfig>) => {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
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
        const hideValue = VALUELESS_OPERATORS.has(condition.operator);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity; list is append/remove-only, not reordered
          <div key={index} className="flex items-start gap-2">
            <Input
              value={condition.field}
              onChange={(e) => updateRow(index, { field: e.target.value })}
              placeholder="${trigger.data.field}"
              className="flex-[1.2] font-mono text-xs"
              data-testid={`input-condition-field-${index}`}
            />
            <Select
              value={condition.operator}
              onValueChange={(value) =>
                updateRow(index, {
                  operator: value as ConditionOperator,
                  value: parseValueForOperator(value as ConditionOperator, valueToInputString(condition.value)),
                })
              }
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
              <Input
                value={valueToInputString(condition.value)}
                onChange={(e) => updateRow(index, { value: parseValueForOperator(condition.operator, e.target.value) })}
                placeholder="value"
                className="flex-1"
                data-testid={`input-condition-value-${index}`}
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
