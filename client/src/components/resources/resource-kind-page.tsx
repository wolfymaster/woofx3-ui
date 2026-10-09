import { api } from "@convex/_generated/api";
import { bareKind, parseKindRef, WOOFX3_MODULE } from "@convex/lib/resourceKinds";
import { useAction, useQuery } from "convex/react";
import { Boxes, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ConfigurationForm, type FieldDescriptor, type FieldValues } from "@/components/common/configuration-form";
import { EmptyState } from "@/components/common/empty-state";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { CreateResourceDialog } from "@/components/modules/create-resource-dialog";
import { GenericResourceDetail } from "@/components/resources/generic-resource-detail";
import { type KindView, kindViewFor } from "@/components/resources/kind-views";
import { ResourceActionEditors } from "@/components/resources/resource-action-editors";
import { ResourceTriggerEditors } from "@/components/resources/resource-trigger-editors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { dynamicLucideIcon } from "@/lib/dynamic-lucide-icon";
import { resourceKindFieldOptionsOwner, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { parseConfigFields } from "@/lib/parse-config-fields";
import { type ResourceInstanceDoc, resourceName, resourceSettings } from "@/lib/resource-instance";
import { pluralKindName } from "@/lib/resource-kind-route";
import { summarizeResourceValue } from "@/lib/resource-values";
import { subPathSegments } from "@/lib/route-subpath";
import { cn } from "@/lib/utils";

export type { ResourceInstanceDoc };

export interface ResourceDetailProps {
  instance: ResourceInstanceDoc;
  /** The instance's current value; null when it holds nothing yet. */
  value: unknown;
  settings: Record<string, unknown>;
  /** The manifest id of the module providing the kind — whose actions change it. */
  moduleName: string;
}

interface ResourceKindPageProps {
  /** The resource kind this page is for, as `module:kind`, e.g. `woofx3:counter`. */
  kind: string;
  /** Where this page is routed; an instance lives at `<basePath>/<its id>`. */
  basePath: string;
}

/**
 * The page for one kind of module-provided resource, whichever module declares
 * it: the instances on the left, the chosen one on the right.
 *
 * Everything that is the same for every kind lives here — finding the module
 * that provides it, listing and creating instances with the kind's own settings
 * form, keeping values fresh, the triggers its events offer, showing settings
 * and deleting. What an instance holds and the controls for it come from the
 * kind's view (see `kindViewFor`), or, for a kind the dashboard has none made
 * for, from its declarations alone.
 */
export function ResourceKindPage({ kind, basePath }: ResourceKindPageProps) {
  const [location, navigate] = useLocation();
  const { instance } = useInstance();
  const { toast } = useToast();
  const instanceId = instance?._id;

  const kindDefinition = useQuery(api.resourceKinds.getForInstance, instanceId ? { instanceId, kind } : "skip");
  const instances = useQuery(api.moduleResourceInstances.listByKind, instanceId ? { instanceId, kind } : "skip");
  const values = useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId } : "skip");
  const createInstance = useAction(api.moduleResourceActions.createResourceInstance);
  const updateInstance = useAction(api.moduleResourceActions.updateResourceInstance);
  const deleteInstance = useAction(api.moduleResourceActions.deleteResourceInstance);
  const refreshValues = useAction(api.moduleResourceActions.refreshResourceValues);

  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResourceInstanceDoc | null>(null);

  // Values change through webhooks once the page is open; this fills in any
  // written before it was, or while a webhook went missing.
  useEffect(() => {
    if (!instanceId) {
      return;
    }
    refreshValues({ instanceId, kind }).catch(() => {
      // The mirror still shows the last known values; the next change updates it.
    });
  }, [instanceId, kind, refreshValues]);

  const sorted = useMemo(
    () => [...(instances ?? [])].sort((a, b) => resourceName(a).localeCompare(resourceName(b))),
    [instances]
  );
  // The one segment below this kind's route names the instance on show, if any.
  const selectedId = subPathSegments(location, basePath)[0] ?? "";
  const selected = sorted.find((row) => row.resourceInstanceId === selectedId);
  const kindName = bareKind(kind);
  const noun = kindDefinition?.name.toLowerCase() ?? kindName;
  const view = kindViewFor(kind) ?? declaredKindView(kind, kindDefinition?.summaryPath);
  const title = pluralKindName(capitalize(kindDefinition?.name || kindName));
  const icon = kindDefinition?.icon ? dynamicLucideIcon(kindDefinition.icon) : (view.icon ?? Boxes);
  const description = view.description ?? kindDefinition?.description ?? "";

  const detailProps = (row: ResourceInstanceDoc): ResourceDetailProps => ({
    instance: row,
    value: values?.[row.canonicalId] ?? null,
    settings: resourceSettings(row),
    moduleName: kindDefinition?.moduleName ?? row.moduleName,
  });

  if (!instanceId || kindDefinition === undefined || instances === undefined) {
    return (
      <div className="p-6 lg:p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (kindDefinition === null) {
    return (
      <div className="p-6 lg:p-8 max-w-[900px]">
        <EmptyState
          icon={icon}
          title={`${title} aren't available yet`}
          description={
            parseKindRef(kind)?.module === WOOFX3_MODULE
              ? `No installed module provides ${kindName}s. They come with the woofx3 module — restart the engine to install its latest version.`
              : `No installed module provides ${title.toLowerCase()} called "${kind}". Install the module that does, or check the address.`
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <nav className={SIDEBAR_RAIL} aria-label={title}>
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <span className="text-sm font-semibold">{title}</span>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid={`button-new-${kindName}`}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {sorted.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">No {noun}s yet.</p>
            ) : (
              sorted.map((row) => {
                const isActive = row.resourceInstanceId === selectedId;
                return (
                  <Link key={row._id} href={`${basePath}/${encodeURIComponent(row.resourceInstanceId)}`}>
                    <span
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[15px] cursor-pointer hover:bg-accent",
                        isActive && "bg-accent font-medium"
                      )}
                      aria-current={isActive ? "page" : undefined}
                      data-testid={`resource-${row.resourceInstanceId}`}
                    >
                      <span className="truncate">{resourceName(row)}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {view.railValue(detailProps(row))}
                      </span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </ScrollArea>
      </nav>

      <div className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[900px] space-y-6">
          {!selected ? (
            sorted.length === 0 ? (
              <EmptyState
                icon={icon}
                title={`No ${noun}s yet`}
                description={description}
                action={{ label: `New ${noun}`, onClick: () => setCreating(true) }}
              />
            ) : (
              <EmptyState
                icon={icon}
                title={selectedId ? `No ${noun} called "${selectedId}"` : `Choose a ${noun}`}
                description={selectedId ? `It may have been deleted.` : description}
              />
            )
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight truncate">{resourceName(selected)}</h1>
                  <p className="text-xs font-mono text-muted-foreground break-all">{selected.canonicalId}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => setDeleteTarget(selected)}
                  aria-label={`Delete ${resourceName(selected)}`}
                  data-testid={`button-delete-${kindName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {view.detail(detailProps(selected))}

              <ResourceActionEditors key={selected.canonicalId} kind={kind} instance={selected} />

              <ResourceTriggerEditors
                kind={kind}
                instance={selected}
                triggerDetail={view.triggerDetail && ((preset) => view.triggerDetail?.(preset, detailProps(selected)))}
              />

              <SettingsCard
                instance={selected}
                moduleId={kindDefinition.moduleName}
                schema={kindDefinition.schema}
                settings={resourceSettings(selected)}
                onSave={async (displayName, settings) => {
                  try {
                    await updateInstance({
                      instanceId,
                      canonicalId: selected.canonicalId,
                      displayName,
                      settings,
                    });
                  } catch (err) {
                    toast({
                      title: "Couldn't save those settings",
                      description: err instanceof Error ? err.message : String(err),
                      variant: "destructive",
                    });
                  }
                }}
              />
            </>
          )}
        </div>
      </div>

      {creating && (
        <CreateResourceDialog
          moduleId={kindDefinition.moduleName}
          kind={{ kind: kindDefinition.kind, name: kindDefinition.name, schema: kindDefinition.schema }}
          onClose={() => setCreating(false)}
          onCreate={async (resourceInstanceId, displayName, settings) => {
            await createInstance({
              instanceId,
              moduleName: kindDefinition.moduleName,
              kind: kindDefinition.kind,
              resourceInstanceId,
              displayName,
              settings,
            });
            navigate(`${basePath}/${encodeURIComponent(resourceInstanceId)}`);
          }}
        />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget ? resourceName(deleteTarget) : noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its value is gone for good, and workflows or commands that use it will stop finding it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) {
                  return;
                }
                try {
                  await deleteInstance({ instanceId, canonicalId: deleteTarget.canonicalId });
                  navigate(basePath);
                } catch (err) {
                  toast({
                    title: `Couldn't delete ${resourceName(deleteTarget)}`,
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                } finally {
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * An instance's name and settings: what it was created with, and what it can be
 * changed to. Identity is not here, because it never changes — everything
 * referencing the instance holds it.
 *
 * Editing opens a draft, so a half-typed name is never saved, and the card
 * follows the stored values again as soon as it closes.
 */
function SettingsCard({
  instance,
  moduleId,
  schema,
  settings,
  onSave,
}: {
  instance: ResourceInstanceDoc;
  /** Manifest-local id of the module that declares the instance's kind. */
  moduleId: string;
  schema: unknown[];
  settings: Record<string, unknown>;
  onSave: (displayName: string, settings: Record<string, unknown>) => Promise<void>;
}) {
  const fields = useMemo(
    () => withFieldOptionsOwner(parseConfigFields(schema), resourceKindFieldOptionsOwner(moduleId, instance.kind)),
    [schema, moduleId, instance.kind]
  );
  const [draft, setDraft] = useState<{ displayName: string; settings: FieldValues } | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Settings</h2>
        {draft === null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDraft({ displayName: resourceName(instance), settings: { ...settings } })}
            data-testid="button-edit-settings"
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || draft.displayName.trim() === ""}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(draft.displayName.trim(), draft.settings as Record<string, unknown>);
                  setDraft(null);
                } finally {
                  setSaving(false);
                }
              }}
              data-testid="button-save-settings"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        )}
      </div>

      {draft === null ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <div className="contents">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{resourceName(instance)}</dd>
          </div>
          {fields.map((field) => {
            const raw = settings[field.id] ?? field.defaultValue;
            const option = field.options?.find((candidate) => candidate.value === String(raw));
            return (
              <div key={field.id} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd>{option?.label ?? (raw === undefined || raw === "" ? "—" : String(raw))}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="resource-display-name">Name</Label>
            <Input
              id="resource-display-name"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              data-testid="input-resource-display-name"
            />
          </div>
          {fields.length > 0 && (
            <ConfigurationForm
              fields={fields as unknown as FieldDescriptor[]}
              values={draft.settings}
              onChange={(values) => setDraft({ ...draft, settings: values })}
              customRenderers={configFieldRenderers}
            />
          )}
        </div>
      )}
    </Card>
  );
}

/** The view of a kind the dashboard has none made for, built from its declarations alone. */
function declaredKindView(kind: string, summaryPath: string | undefined): KindView {
  return {
    railValue: (props) => summarizeResourceValue(props.value, summaryPath),
    detail: (props) => <GenericResourceDetail {...props} qualifiedKind={kind} />,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
