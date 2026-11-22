import { bareKind, parseKindRef } from "@shared/resource-kinds";
import { FileAudio, FileImage, FileVideo, Link2, Plus, Upload, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { CreateResourceDialog } from "@/components/modules/create-resource-dialog";
import { AlertLayoutField } from "@/components/scenes/alert-layout-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEngineScope } from "@/engine/context";
import {
  useCreateResourceInstanceRequest,
  useResourceInstancesOfKind,
  useResourceKind,
} from "@/engine/hooks/use-module-resources";
import { useAlertWidgetNames } from "@/engine/hooks/use-scenes";
import { alertTargetChoices } from "@/lib/alert-target";
import { isExternalMediaValue, toMediaValue } from "@/lib/media-value";
import { AssetLibraryModal } from "./asset-library-modal";

// ---------------------------------------------------------------------------
// Media field — uses AssetLibraryModal, so it lives here as a custom renderer
// rather than in the generic ConfigurationForm. The stored value is a
// MediaValue: a library asset or an external URL.
// ---------------------------------------------------------------------------

function MediaField({ field, value, onChange }: Parameters<CustomFieldRenderer>[0]) {
  const [modalOpen, setModalOpen] = useState(false);
  const FileIcon = field.mediaType === "audio" ? FileAudio : field.mediaType === "video" ? FileVideo : FileImage;

  const assetValue = toMediaValue(value);
  const isExternal = assetValue !== null && isExternalMediaValue(assetValue);
  const MediaIcon = isExternal ? Link2 : FileIcon;
  const filterTypes = field.mediaType ? [field.mediaType] : undefined;

  return (
    <div className="space-y-2">
      <Label>{field.label}</Label>
      {assetValue ? (
        <Card className="p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <MediaIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm truncate" title={assetValue.url}>
              {assetValue.name}
            </span>
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
          Browse Library or URL
        </Button>
      )}

      <AssetLibraryModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSelect={onChange}
        filterTypes={filterTypes}
        current={assetValue}
        title={`Select ${field.label}`}
        description={`Choose ${field.mediaType ? `a ${field.mediaType} file` : "an asset"} from your library, upload one, or link to one hosted elsewhere.`}
      />
    </div>
  );
}

export const MediaFieldRenderer: CustomFieldRenderer = (props) => <MediaField {...props} />;

// ---------------------------------------------------------------------------
// Resource-ref field — module-declared "kind" picker (e.g. counters). Lists
// live instances from Convex (kept in sync via engine webhook, no round trip
// needed) and lets the user create a new one through the same REST-proxy
// action the module management page uses. Lives here rather than in the
// generic ConfigurationForm because it needs instance/Convex context.
// ---------------------------------------------------------------------------

function ResourceRefField({ field, value, onChange }: Parameters<CustomFieldRenderer>[0]) {
  const { instanceId } = useEngineScope();
  const resourceKind = typeof field.resourceKind === "string" ? field.resourceKind : undefined;
  const moduleName = typeof field.moduleName === "string" ? field.moduleName : undefined;
  const [createOpen, setCreateOpen] = useState(false);

  const instances = useResourceInstancesOfKind(resourceKind || null);
  const createAction = useCreateResourceInstanceRequest();
  // The kind's declaration: the module an instance made from here belongs to,
  // and its create form, so it is configured the same way as one made on the
  // kind's own page.
  const kindDefinition = useResourceKind(resourceKind || null);
  // Until the kind's declaration is known, a qualified kind still names its
  // module, and a bare one is taken to be the field's own module's.
  const owner =
    kindDefinition?.moduleName ?? (resourceKind ? parseKindRef(resourceKind)?.module : undefined) ?? moduleName;

  const options = instances ?? [];
  const loading = !!instanceId && !!resourceKind && instances === undefined;
  const empty = !loading && options.length === 0;

  let placeholder: string;
  if (!instanceId || !resourceKind) {
    placeholder = "No engine selected";
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
          disabled={!instanceId || !resourceKind || !owner}
          onClick={() => setCreateOpen(true)}
          data-testid={`button-new-${field.id}`}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint as string}</p>}

      {createOpen && instanceId && resourceKind && owner && (
        <CreateResourceDialog
          key={kindDefinition ? "with-schema" : "without-schema"}
          moduleId={owner}
          kind={{ kind: bareKind(resourceKind), name: field.label, schema: kindDefinition?.schema }}
          onClose={() => setCreateOpen(false)}
          onCreate={async (resourceInstanceId, displayName, settings) => {
            const created = await createAction({
              moduleName: owner,
              kind: bareKind(resourceKind),
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
}

export const ResourceRefFieldRenderer: CustomFieldRenderer = (props) => <ResourceRefField {...props} />;

// ---------------------------------------------------------------------------
// Alert widget name — picked from the names the alert widgets on the
// instance's scenes answer to, so a typo cannot reach stream time. A target is
// named in the scene editor first and picked here second; a stored name no
// scene has stays selected and flagged rather than replaced.
// ---------------------------------------------------------------------------

function AlertWidgetNameField({ field, value, onChange }: Parameters<CustomFieldRenderer>[0]) {
  const names = useAlertWidgetNames();
  const { selected, options, stale } = alertTargetChoices(names, value);
  const noWidgets = names !== undefined && options.length === 0;

  let placeholder: string;
  if (names === undefined) {
    placeholder = "Loading...";
  } else if (noWidgets) {
    placeholder = "No alert widgets on any scene yet";
  } else {
    placeholder = "Choose an alert widget...";
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Select value={selected} onValueChange={onChange} disabled={names === undefined || noWidgets}>
        <SelectTrigger id={field.id} data-testid={`select-${field.id}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((name) => (
            <SelectItem key={name} value={name}>
              {name === stale ? `${name} — not on any scene` : name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {stale !== null && (
        <p className="text-xs text-destructive" data-testid={`warning-${field.id}`}>
          No scene has an alert widget named "{stale}". Alerts on this step won't show until one does.
        </p>
      )}
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}
      <Link href="/stream/scenes" className="text-xs text-primary underline-offset-4 hover:underline">
        Name alert widgets in the scene editor
      </Link>
    </div>
  );
}

export const AlertWidgetNameRenderer: CustomFieldRenderer = (props) => <AlertWidgetNameField {...props} />;

// ---------------------------------------------------------------------------
// Layout — a canvas of widgets, edited in a dialog. The layout's widget
// settings use these same renderers, so a media picker in an alert works as it
// does everywhere else.
// ---------------------------------------------------------------------------

/**
 * A layout places the widgets of one surface. Only alerts are laid out per step; a
 * field naming another surface is shown, not edited, and its value is kept as it is.
 */
export const LayoutFieldRenderer: CustomFieldRenderer = (props) => {
  const surface = props.field.surface;
  if (surface === undefined || surface === "alert") {
    return <AlertLayoutField {...props} />;
  }
  return (
    <div className="space-y-1">
      <Label>{props.field.label}</Label>
      <p className="text-xs text-muted-foreground" data-testid={`text-layout-unsupported-${props.field.id}`}>
        A {String(surface)} layout can't be edited here yet. Whatever it holds is kept as it is.
      </p>
    </div>
  );
};
