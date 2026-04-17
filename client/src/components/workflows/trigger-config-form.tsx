import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileAudio, FileImage, FileVideo, Upload, X } from "lucide-react";
import { type ConfigField, type TriggerConfigValues } from "@/lib/workflow-presets";
import {
  ConfigurationForm,
  type CustomFieldRenderer,
  type FieldDescriptor,
} from "@/components/common/configuration-form";
import { AssetLibraryModal } from "./asset-library-modal";
import type { Asset } from "@/types";

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

  const handleSelect = (asset: Asset) => {
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
// TriggerConfigForm — thin wrapper around ConfigurationForm
// ---------------------------------------------------------------------------

interface TriggerConfigFormProps {
  fields: ConfigField[];
  values: TriggerConfigValues;
  onChange: (values: TriggerConfigValues) => void;
  className?: string;
}

const customRenderers: Record<string, CustomFieldRenderer> = {
  media: MediaFieldRenderer,
};

export function TriggerConfigForm({ fields, values, onChange, className }: TriggerConfigFormProps) {
  return (
    <ConfigurationForm
      // ConfigField has a narrower, intentional shape (see workflow-presets);
      // FieldDescriptor is ConfigurationForm's structural superset. The cast
      // is a runtime no-op — every ConfigField already satisfies the renderer
      // requirements.
      fields={fields as unknown as FieldDescriptor[]}
      values={values as Record<string, unknown>}
      onChange={(v) => onChange(v as TriggerConfigValues)}
      customRenderers={customRenderers}
      className={className}
    />
  );
}
