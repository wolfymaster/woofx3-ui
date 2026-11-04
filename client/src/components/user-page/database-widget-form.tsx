import { parseDatabaseColumns } from "@shared/databases/columns";
import { DATABASE_KIND } from "@shared/resource-kinds";
import { DATABASE_WIDGET_SORT_CREATED, type PageWidgetConfig, USER_PAGE_LIMITS } from "@shared/user-pages";
import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldProblems } from "@/components/user-page/field-problems";
import { FieldFrame, SwitchField, TextField } from "@/components/user-page/fields";
import { ResourcePicker } from "@/components/user-page/resource-picker";
import { useResourceInstancesOfKind } from "@/engine/hooks/use-module-resources";
import { fieldPath, type ProblemIndex } from "@/lib/page-problems";
import { resourceSettings } from "@/lib/resource-instance";
import { optionalText } from "@/lib/user-page-editor";
import { parseWholeNumber } from "@/lib/user-page-widgets";

type Config = PageWidgetConfig<"database">;

interface DatabaseWidgetFormProps {
  idPrefix: string;
  config: Config;
  onChange: (config: Config) => void;
  path: string;
  problems: ProblemIndex;
}

/** The public columns of the chosen database, the only ones a page can show. */
function usePublicColumns(databaseId: string) {
  const instances = useResourceInstancesOfKind(DATABASE_KIND);
  return useMemo(() => {
    const instance = instances?.find((row) => row.canonicalId === databaseId);
    return instance ? parseDatabaseColumns(resourceSettings(instance)).filter((column) => column.public) : [];
  }, [instances, databaseId]);
}

/** Which public columns a database widget shows, how it sorts them and how many rows. */
export function DatabaseWidgetForm({ idPrefix, config, onChange, path, problems }: DatabaseWidgetFormProps) {
  const columns = usePublicColumns(config.resource);
  const chosen = new Set(config.columns);
  const toggle = (columnId: string, on: boolean) => {
    const next = on
      ? columns.filter((column) => chosen.has(column.id) || column.id === columnId).map((column) => column.id)
      : config.columns.filter((id) => id !== columnId);
    onChange({ ...config, columns: next });
  };

  return (
    <div className="space-y-4">
      <FieldFrame id={`${idPrefix}-resource`} label="Database" path={fieldPath(path, "resource")} problems={problems}>
        <ResourcePicker
          id={`${idPrefix}-resource`}
          kind={DATABASE_KIND}
          value={config.resource}
          onChange={(resource) => onChange({ ...config, resource, columns: [], sortBy: DATABASE_WIDGET_SORT_CREATED })}
        />
        <FieldProblems messages={problems.at(path)} />
      </FieldFrame>
      <TextField
        id={`${idPrefix}-label`}
        label="Label"
        value={config.label ?? ""}
        onChange={(label) => {
          const { label: _previous, ...rest } = config;
          const text = optionalText(label);
          onChange(text === undefined ? rest : { ...rest, label: text });
        }}
        path={fieldPath(path, "label")}
        problems={problems}
      />
      <FieldFrame
        id={`${idPrefix}-columns`}
        label="Columns"
        hint={`Up to ${USER_PAGE_LIMITS.databaseWidgetColumns}.`}
        path={fieldPath(path, "columns")}
        problems={problems}
      >
        {config.resource !== "" && columns.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-no-public-columns`}>
            This database has no column shown on your public page yet. Turn on "Show on your public page" for a column
            in the database first.
          </p>
        )}
        {columns.map((column) => (
          <SwitchField
            key={column.id}
            id={`${idPrefix}-column-${column.id}`}
            label={column.label}
            checked={chosen.has(column.id)}
            onChange={(on) => toggle(column.id, on)}
          />
        ))}
      </FieldFrame>
      <FieldFrame id={`${idPrefix}-sort`} label="Sort by" path={fieldPath(path, "sortBy")} problems={problems}>
        <div className="flex gap-2">
          <Select value={config.sortBy} onValueChange={(sortBy) => onChange({ ...config, sortBy })}>
            <SelectTrigger id={`${idPrefix}-sort`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DATABASE_WIDGET_SORT_CREATED}>When added</SelectItem>
              {columns.map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={config.direction}
            onValueChange={(direction) => onChange({ ...config, direction: direction === "asc" ? "asc" : "desc" })}
          >
            <SelectTrigger className="w-40" aria-label="Order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Lowest first</SelectItem>
              <SelectItem value="desc">Highest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FieldFrame>
      <TextField
        id={`${idPrefix}-limit`}
        label="Rows shown"
        type="number"
        value={String(config.limit)}
        onChange={(limit) => onChange({ ...config, limit: parseWholeNumber(limit) })}
        path={fieldPath(path, "limit")}
        problems={problems}
      />
    </div>
  );
}
