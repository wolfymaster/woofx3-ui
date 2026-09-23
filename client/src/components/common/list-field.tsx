import { Plus, X } from "lucide-react";
import { ConfigFieldDescription, ConfigFieldLabel } from "@/components/common/config-field-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { listRows, withRowChanged, withRowRemoved } from "@/lib/list-field-rows";

/** One field of a row; the engine allows only these types in a row (`LIST_ITEM_FIELD_TYPES`). */
interface ItemField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

interface ListFieldProps {
  field: {
    id: string;
    label: string;
    required?: boolean;
    description?: string;
    hint?: string;
    itemFields?: ItemField[];
  };
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * A `list` config field: rows of the declared item fields, added and removed
 * one at a time, with each column's label shown once above the rows.
 */
export function ListField({ field, value, onChange }: ListFieldProps) {
  const itemFields = field.itemFields ?? [];
  const rows = listRows(value, itemFields[0]?.id);
  const columns = itemFields.map((item) => (item.type === "number" ? "8rem" : "minmax(0, 1fr)")).join(" ");
  const gridTemplateColumns = `${columns} 2.25rem`;

  return (
    <div className="space-y-2" data-testid={`list-${field.id}`}>
      <ConfigFieldLabel label={field.label} required={field.required} hint={field.hint} />
      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="grid gap-2 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns }}>
            {itemFields.map((item) => (
              <span key={item.id}>
                {item.label}
                {item.required && <span className="text-destructive ml-0.5">*</span>}
              </span>
            ))}
          </div>
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity; list is append/remove-only, not reordered
            <div key={index} className="grid items-center gap-2" style={{ gridTemplateColumns }}>
              {itemFields.map((item) => (
                <ItemControl
                  key={item.id}
                  item={item}
                  value={row[item.id]}
                  onChange={(next) => onChange(withRowChanged(rows, index, item.id, next))}
                  testId={`input-${field.id}-${index}-${item.id}`}
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(withRowRemoved(rows, index))}
                aria-label={`Remove row ${index + 1}`}
                data-testid={`button-remove-${field.id}-${index}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...rows, {}])}
        data-testid={`button-add-${field.id}`}
      >
        <Plus className="h-3.5 w-3.5" />
        Add {itemFields[0]?.label.toLowerCase() ?? "row"}
      </Button>
      <ConfigFieldDescription description={field.description} />
    </div>
  );
}

function ItemControl({
  item,
  value,
  onChange,
  testId,
}: {
  item: ItemField;
  value: unknown;
  onChange: (value: unknown) => void;
  testId: string;
}) {
  switch (item.type) {
    case "number":
      return (
        <Input
          type="number"
          value={typeof value === "number" || typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder={item.placeholder}
          aria-label={item.label}
          data-testid={testId}
        />
      );
    case "select":
      return (
        <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
          <SelectTrigger aria-label={item.label} data-testid={testId}>
            <SelectValue placeholder={item.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {(item.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "toggle":
      return (
        <Switch checked={value === true} onCheckedChange={onChange} aria-label={item.label} data-testid={testId} />
      );
    case "color":
      return (
        <input
          type="color"
          value={typeof value === "string" ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full cursor-pointer rounded-md border bg-transparent"
          aria-label={item.label}
          data-testid={testId}
        />
      );
    default:
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={item.placeholder}
          aria-label={item.label}
          data-testid={testId}
        />
      );
  }
}
