import { api } from "@convex/_generated/api";
import { DEFAULT_ALERT_WIDGET_NAME } from "@convex/lib/alertWidgets";
import { useAction, useQuery } from "convex/react";
import { FileAudio, FileImage, FileVideo, Plus, Upload, X } from "lucide-react";
import { useState } from "react";
import {
  ConfigurationForm,
  type CustomFieldRenderer,
  type FieldDescriptor,
} from "@/components/common/configuration-form";
import { CreateResourceDialog } from "@/components/modules/create-resource-dialog";
import { AlertLayoutField } from "@/components/scenes/alert-layout-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstance } from "@/hooks/use-instance";
import type { ConfigField, TriggerConfigValues } from "@/lib/workflow-presets";
import type { VariableOption } from "@/lib/workflow-variables";
import { AssetLibraryModal, type SelectedAsset } from "./asset-library-modal";

// ---------------------------------------------------------------------------
// Media field — uses AssetLibraryModal, so it lives here as a custom renderer
// rather than in the generic ConfigurationForm.
// ---------------------------------------------------------------------------

interface MediaFieldValue {
  id: string;
  name: string;
  url: string;
  type: string;
}

const MediaFieldRenderer: CustomFieldRenderer = ({ field, value, onChange }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const MediaIcon = field.mediaType === "audio" ? FileAudio : field.mediaType === "video" ? FileVideo : FileImage;

  const assetValue = value as MediaFieldValue | null;
  const filterTypes = field.mediaType ? [field.mediaType] : undefined;

  const handleSelect = (asset: SelectedAsset) => {
    onChange({
      id: asset.id,
      name: asset.name,
      url: asset.url,
      type: asset.type,
    });
  };

  return (
    <div className="space-y-2">
      <Label>{field.label}</Label>
      {assetValue ? (
        <Card className="p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <MediaIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm truncate">{assetValue.name}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModalOpen(true)}
              data-testid={`button-change-${field.id}`}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onChange(null)}
              data-testid={`button-remove-${field.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => setModalOpen(true)}
          data-testid={`button-select-${field.id}`}
        >
          <Upload className="h-4 w-4" />
          Browse Library
        </Button>
      )}

      <AssetLibraryModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSelect={handleSelect}
        filterTypes={filterTypes}
        title={`Select ${field.label}`}
        description={`Choose ${field.mediaType ? `a ${field.mediaType} file` : "an asset"} from your library or upload a new one.`}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Resource-ref field — module-declared "kind" picker (e.g. counters). Lists
// live instances from Convex (kept in sync via engine webhook, no round trip
// needed) and lets the user create a new one through the same REST-proxy
// action the module management page uses. Lives here rather than in the
// generic ConfigurationForm because it needs instance/Convex context.
// ---------------------------------------------------------------------------

const ResourceRefFieldRenderer: CustomFieldRenderer = ({ field, value, onChange }) => {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const resourceKind = typeof field.resourceKind === "string" ? field.resourceKind : undefined;
  const moduleName = typeof field.moduleName === "string" ? field.moduleName : undefined;
  const [createOpen, setCreateOpen] = useState(false);

  const instances = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId && resourceKind ? { instanceId, kind: resourceKind } : "skip"
  );
  const createAction = useAction(api.moduleResourceActions.createResourceInstance);
  // The kind's create form, so an instance made from here is configured the same
  // way as one made on the kind's own page.
  const kindDefinition = useQuery(
    api.resourceKinds.getForInstance,
    instanceId && resourceKind && createOpen ? { instanceId, kind: resourceKind } : "skip"
  );

  const options = instances ?? [];
  const loading = !!instanceId && !!resourceKind && instances === undefined;
  const empty = !loading && options.length === 0;

  let placeholder: string;
  if (!instanceId || !resourceKind) {
    placeholder = "No instance selected";
  } else if (loading) {
    placeholder = "Loading...";
  } else if (empty) {
    placeholder = `No ${field.label.toLowerCase()} yet — create one`;
  } else {
    placeholder = field.placeholder ?? `Select ${field.label.toLowerCase()}...`;
  }

  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={(value as string) ?? ""}
          onValueChange={onChange}
          disabled={!instanceId || !resourceKind || loading}
        >
          <SelectTrigger className="flex-1" data-testid={`select-${field.id}`}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.canonicalId} value={opt.canonicalId}>
                {opt.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          disabled={!instanceId || !resourceKind || !moduleName}
          onClick={() => setCreateOpen(true)}
          data-testid={`button-new-${field.id}`}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint as string}</p>}

      {createOpen && instanceId && resourceKind && moduleName && (
        <CreateResourceDialog
          key={kindDefinition ? "with-schema" : "without-schema"}
          kind={{ kind: resourceKind, name: field.label, schema: kindDefinition?.schema }}
          onClose={() => setCreateOpen(false)}
          onCreate={async (resourceInstanceId, displayName, settings) => {
            const created = await createAction({
              instanceId,
              moduleName,
              kind: resourceKind,
              resourceInstanceId,
              displayName,
              settings,
            });
            onChange(created.canonicalId);
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Alert widget name — free text, suggesting the names of the alert widgets
// already placed on the instance's scenes. Free text so a step can target a
// name before any scene has an alert widget answering to it.
// ---------------------------------------------------------------------------

function AlertWidgetNameField({ field, value, onChange }: Parameters<CustomFieldRenderer>[0]) {
  const { instance } = useInstance();
  const names = useQuery(api.sceneWidgets.alertWidgetNames, instance ? { instanceId: instance._id } : "skip") ?? [];
  const listId = `alert-widget-names-${field.id}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={field.id}
        list={listId}
        value={typeof value === "string" ? value : ""}
        placeholder={DEFAULT_ALERT_WIDGET_NAME}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`input-${field.id}`}
      />
      <datalist id={listId}>
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  );
}

const AlertWidgetNameRenderer: CustomFieldRenderer = (props) => <AlertWidgetNameField {...props} />;

// ---------------------------------------------------------------------------
// Layout — a canvas of widgets, edited in a dialog. The layout's widget
// settings use these same renderers, so a media picker in an alert works as it
// does everywhere else.
// ---------------------------------------------------------------------------

const LayoutFieldRenderer: CustomFieldRenderer = (props) => (
  <AlertLayoutField {...props} renderers={configFieldRenderers} />
);

// ---------------------------------------------------------------------------
// TriggerConfigForm — thin wrapper around ConfigurationForm
// ---------------------------------------------------------------------------

interface TriggerConfigFormProps {
  fields: ConfigField[];
  values: TriggerConfigValues;
  onChange: (values: TriggerConfigValues) => void;
  /** Variables offered for {variable} references — see computeAvailableVariables. */
  availableVariables?: VariableOption[];
  /** For trigger conditions — see ConfigurationForm's `allowAny`. */
  allowAny?: boolean;
  /**
   * Replaces the shared renderer for a key, for a surface that shows a field its own way:
   * the triggers page shows an alert's layout as a preview that links to the alert editor.
   */
  rendererOverrides?: Record<string, CustomFieldRenderer>;
  className?: string;
}

/**
 * The renderers ConfigurationForm cannot supply generically, because they need
 * pickers wired to app state — the asset library, the resource instance list,
 * the alert widget names and the layout canvas. Exported so every surface that
 * renders a ConfigField gets the same controls: a `resource_ref` in a widget's
 * settings must pick a resource the same way one in a trigger's config does.
 */
export const configFieldRenderers: Record<string, CustomFieldRenderer> = {
  media: MediaFieldRenderer,
  asset: MediaFieldRenderer,
  resource_ref: ResourceRefFieldRenderer,
  "field:layout": LayoutFieldRenderer,
  "source:alertWidgets": AlertWidgetNameRenderer,
};

export function TriggerConfigForm({
  fields,
  values,
  onChange,
  availableVariables,
  allowAny,
  rendererOverrides,
  className,
}: TriggerConfigFormProps) {
  return (
    <ConfigurationForm
      // ConfigField has a narrower, intentional shape (see workflow-presets);
      // FieldDescriptor is ConfigurationForm's structural superset. The cast
      // is a runtime no-op — every ConfigField already satisfies the renderer
      // requirements.
      fields={fields as unknown as FieldDescriptor[]}
      values={values as Record<string, unknown>}
      onChange={(v) => onChange(v as TriggerConfigValues)}
      customRenderers={rendererOverrides ? { ...configFieldRenderers, ...rendererOverrides } : configFieldRenderers}
      availableVariables={availableVariables}
      allowAny={allowAny}
      className={className}
    />
  );
}
