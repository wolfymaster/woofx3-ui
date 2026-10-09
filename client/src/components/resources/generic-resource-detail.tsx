import { Loader2, Play } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ConfigurationForm, type FieldDescriptor, type FieldValues } from "@/components/common/configuration-form";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { useResourceAction } from "@/hooks/use-resource-action";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { type ResourceAction, resourceActions } from "@/lib/resource-actions";
import { getDefaultConfigValues } from "@/lib/workflow-presets";

/** The most entries of a list shown before the rest are counted instead. */
const MAX_LIST_ENTRIES = 100;

/**
 * What a kind without a first-party page shows of an instance: what it holds,
 * and every action aimed at its kind, from whichever module declares one. Built
 * from the declarations alone, so a module's kind gets a working page without
 * the dashboard knowing what the kind means.
 */
export function GenericResourceDetail(props: ResourceDetailProps & { qualifiedKind: string }) {
  return (
    <>
      <ResourceValueCard value={props.value} />
      <ResourceControls {...props} />
    </>
  );
}

function ResourceValueCard({ value }: { value: unknown }) {
  return (
    <Card className="p-4 space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Holds</h2>
      {value === null || value === undefined ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ValueView value={value} />
      )}
    </Card>
  );
}

/**
 * A value as plainly as its shape allows: text for a single value, a list for a
 * list, a row per field for an object. Anything deeper is shown as JSON.
 */
function ValueView({ value }: { value: unknown }): ReactNode {
  if (isPlain(value)) {
    return <p className="text-2xl font-semibold tabular-nums break-words">{plainText(value)}</p>;
  }
  if (Array.isArray(value)) {
    return <ListView entries={value} />;
  }
  if (value && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>);
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        {fields.map(([key, field]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0">
              {isPlain(field) ? (
                plainText(field)
              ) : Array.isArray(field) && field.every(isPlain) ? (
                <ListView entries={field} />
              ) : (
                <JsonView value={field} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <JsonView value={value} />;
}

function ListView({ entries }: { entries: unknown[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Empty.</p>;
  }
  if (!entries.every(isPlain)) {
    return <JsonView value={entries} />;
  }
  const shown = entries.slice(0, MAX_LIST_ENTRIES);
  return (
    <div className="space-y-1">
      <ol className="list-decimal pl-5 text-sm space-y-0.5">
        {shown.map((entry, index) => (
          // Entries may repeat, so their place is part of what tells them apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: a list of plain values has no ids
          <li key={index} className="break-words">
            {plainText(entry)}
          </li>
        ))}
      </ol>
      {entries.length > shown.length && (
        <p className="text-xs text-muted-foreground">and {(entries.length - shown.length).toLocaleString()} more</p>
      )}
    </div>
  );
}

function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded bg-muted p-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isPlain(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function plainText(value: string | number | boolean | null): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  return String(value);
}

/** Every action aimed at the kind, each run against the instance on show. */
function ResourceControls(props: ResourceDetailProps & { qualifiedKind: string }) {
  const { actionPresets } = useWorkflowCatalog();
  const actions = useMemo(
    () => resourceActions(actionPresets, props.qualifiedKind),
    [actionPresets, props.qualifiedKind]
  );
  const { runAction, pending } = useResourceAction(props);
  const [open, setOpen] = useState<string | null>(null);

  if (actions.length === 0) {
    return null;
  }
  const opened = actions.find((action) => action.preset.id === open);

  return (
    <Card className="p-4 space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Do now</h2>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const asks = otherFields(action).length > 0;
          return (
            <Button
              key={action.preset.id}
              variant={open === action.preset.id ? "secondary" : "outline"}
              size="sm"
              disabled={pending !== null}
              title={action.preset.description || undefined}
              onClick={() => {
                if (asks) {
                  setOpen(open === action.preset.id ? null : action.preset.id);
                  return;
                }
                void runAction(action);
              }}
              data-testid={`button-resource-action-${action.preset.id}`}
            >
              {pending === action.preset.id ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              {action.preset.name}
              {asks ? "…" : ""}
            </Button>
          );
        })}
      </div>
      {opened && (
        <ActionForm
          key={opened.preset.id}
          action={opened}
          running={pending !== null}
          onRun={async (values) => {
            if (await runAction(opened, values)) {
              setOpen(null);
            }
          }}
        />
      )}
    </Card>
  );
}

/** The action's own parameters, without the one that picks the instance. */
function otherFields(action: ResourceAction) {
  return (action.preset.config?.fields ?? []).filter((field) => field.id !== action.fieldId);
}

function ActionForm({
  action,
  running,
  onRun,
}: {
  action: ResourceAction;
  running: boolean;
  onRun: (values: Record<string, unknown>) => Promise<void>;
}) {
  const fields = useMemo(() => otherFields(action), [action]);
  const [values, setValues] = useState<FieldValues>(() => getDefaultConfigValues(fields));

  return (
    <div className="rounded-md border p-3 space-y-2">
      {action.preset.description && <p className="text-xs text-muted-foreground">{action.preset.description}</p>}
      <ConfigurationForm
        fields={fields as unknown as FieldDescriptor[]}
        values={values}
        onChange={setValues}
        onSubmit={(submitted) => {
          if (!running) {
            void onRun(submitted as Record<string, unknown>);
          }
        }}
        submitLabel={action.preset.name}
        customRenderers={configFieldRenderers}
      />
    </div>
  );
}
