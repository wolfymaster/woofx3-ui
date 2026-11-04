import { parseDatabaseColumns } from "@shared/databases/columns";
import { DATABASE_KIND } from "@shared/resource-kinds";
import type { DatabaseColumn } from "@woofx3/api/databases";
import { useEffect, useMemo } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useResourceInstancesOfKind } from "@/engine/hooks/use-module-resources";
import { resourceSettings } from "@/lib/resource-instance";

type RendererProps = Parameters<CustomFieldRenderer>[0];

/** The columns of the database the field's `databaseField` sibling holds; undefined while loading. */
function useSiblingColumns(props: RendererProps): DatabaseColumn[] | undefined {
  const instances = useResourceInstancesOfKind(DATABASE_KIND);
  const source = (props.field as { source?: { databaseField?: unknown } }).source;
  const databaseField = typeof source?.databaseField === "string" ? source.databaseField : "";
  const databaseId = props.values?.[databaseField];
  return useMemo(() => {
    if (instances === undefined) {
      return undefined;
    }
    const instance = instances.find((row) => row.canonicalId === databaseId);
    return instance ? parseDatabaseColumns(resourceSettings(instance)) : [];
  }, [instances, databaseId]);
}

/**
 * A `database_values` value keeping only the columns the database has. A
 * value for a column it lacks would fail the step, so switching the database
 * drops it rather than carrying it over.
 */
export function pruneDatabaseValues(value: unknown, columns: readonly DatabaseColumn[]): Record<string, string> {
  const kept: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return kept;
  }
  const ids = new Set(columns.map((column) => column.id));
  for (const [id, text] of Object.entries(value)) {
    if (ids.has(id) && typeof text === "string") {
      kept[id] = text;
    }
  }
  return kept;
}

function DatabaseValuesField(props: RendererProps) {
  const columns = useSiblingColumns(props);
  const values = useMemo(() => pruneDatabaseValues(props.value, columns ?? []), [props.value, columns]);
  const { onChange, value } = props;
  useEffect(() => {
    if (columns === undefined) {
      return;
    }
    const before = value !== null && typeof value === "object" ? Object.keys(value).length : 0;
    if (before !== Object.keys(values).length) {
      onChange(values);
    }
  }, [columns, values, value, onChange]);

  return (
    <div className="space-y-2">
      <Label>{props.field.label}</Label>
      {columns !== undefined && columns.length === 0 && (
        <p className="text-xs text-muted-foreground">Pick a database with columns first.</p>
      )}
      {(columns ?? []).map((column) => (
        <div key={column.id} className="space-y-1">
          <Label htmlFor={`${props.field.id}-${column.id}`} className="text-xs text-muted-foreground">
            {column.label}
          </Label>
          <VariableAwareInput
            id={`${props.field.id}-${column.id}`}
            value={values[column.id] ?? ""}
            onChange={(text) => props.onChange({ ...values, [column.id]: text })}
            availableVariables={props.availableVariables}
            data-testid={`input-${props.field.id}-${column.id}`}
          />
        </div>
      ))}
      {typeof props.field.description === "string" && (
        <p className="text-xs text-muted-foreground">{props.field.description}</p>
      )}
    </div>
  );
}

function DatabaseColumnSelect(props: RendererProps) {
  const columns = useSiblingColumns(props);
  const selected = typeof props.value === "string" ? props.value : "";
  return (
    <div className="space-y-2">
      <Label htmlFor={props.field.id}>
        {props.field.label}
        {props.field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Select value={selected} onValueChange={props.onChange} disabled={columns === undefined || columns.length === 0}>
        <SelectTrigger id={props.field.id} data-testid={`select-${props.field.id}`}>
          <SelectValue placeholder={columns?.length === 0 ? "Pick a database first" : undefined} />
        </SelectTrigger>
        <SelectContent>
          {(columns ?? []).map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {column.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {typeof props.field.description === "string" && (
        <p className="text-xs text-muted-foreground">{props.field.description}</p>
      )}
    </div>
  );
}

/**
 * `source: { kind: "databaseColumns", databaseField }`: one input per column
 * of the chosen database on a `database_values` field, a column picker on a
 * `select`.
 */
export const DatabaseColumnsFieldRenderer: CustomFieldRenderer = (props) =>
  props.field.type === "database_values" ? <DatabaseValuesField {...props} /> : <DatabaseColumnSelect {...props} />;
