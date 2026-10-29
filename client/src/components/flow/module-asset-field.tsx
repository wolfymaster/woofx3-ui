import type { ConfigField } from "@woofx3/api/ui-schema";
import type { ReactNode } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { Label } from "@/components/ui/label";
import { useModuleAssets } from "@/engine/hooks/use-modules";
import type { ModuleAsset, ModuleId } from "@/engine/types";
import { cn } from "@/lib/utils";

/** The property a step's `asset` fields carry to name the module whose assets they list. */
export const ASSET_MODULE_PROPERTY = "assetModuleId";

/**
 * An `asset` field: one of the files its own module ships, picked from a row of
 * choices. The spec scopes the field to the declaring module's `assets[]`,
 * narrowed to the field's `kinds`, and stores the asset's canonical id; the
 * streamer's own uploads are a `media` field's business.
 */
function ModuleAssetField(props: Parameters<CustomFieldRenderer>[0]) {
  const moduleId = props.field[ASSET_MODULE_PROPERTY] as ModuleId | undefined;
  return moduleId ? (
    <InstalledModuleAssetField {...props} moduleId={moduleId} />
  ) : (
    <AssetChoices {...props} assets={null} />
  );
}

type AssetFieldProps = Pick<Parameters<CustomFieldRenderer>[0], "field" | "value" | "onChange">;

function InstalledModuleAssetField({ moduleId, ...props }: AssetFieldProps & { moduleId: ModuleId }) {
  const kinds = Array.isArray(props.field.kinds) ? (props.field.kinds as string[]) : undefined;
  const assets = useModuleAssets(moduleId, kinds);
  return <AssetChoices {...props} assets={assets} />;
}

/** `assets` is null for a field whose module is not installed, and undefined while they load. */
function AssetChoices({
  field,
  value,
  onChange,
  assets,
}: AssetFieldProps & { assets: ModuleAsset[] | null | undefined }) {
  const kinds = Array.isArray(field.kinds) ? (field.kinds as string[]) : undefined;
  const selected = typeof value === "string" ? value : "";
  const labelId = `${field.id}-label`;

  let body: ReactNode;
  if (assets === null) {
    body = <p className="text-xs text-muted-foreground">This action's module isn't installed, so it has no files.</p>;
  } else if (assets === undefined) {
    body = <p className="text-xs text-muted-foreground">Loading the module's files…</p>;
  } else if (assets.length === 0) {
    body = (
      <p className="text-xs text-muted-foreground">
        {kinds && kinds.length > 0
          ? `The module ships no ${kinds.join(" or ")} files to choose from.`
          : "The module ships no files to choose from."}
      </p>
    );
  } else {
    const missing = selected !== "" && !assets.some((asset) => asset.canonicalId === selected);
    body = (
      // biome-ignore lint/a11y/useSemanticElements: a row of toggle chips, not a form field set.
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {assets.map((asset) => {
          const pressed = asset.canonicalId === selected;
          return (
            <button
              key={asset.canonicalId}
              type="button"
              aria-pressed={pressed}
              title={asset.description}
              onClick={() => onChange(pressed && !field.required ? "" : asset.canonicalId)}
              className={cn(
                "min-h-8 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                pressed ? "border-primary/50 bg-primary/10 text-primary" : "bg-background hover:bg-muted"
              )}
              data-testid={`chip-asset-${asset.canonicalId}`}
            >
              {asset.name}
            </button>
          );
        })}
        {missing && (
          <span className="flex min-h-8 items-center rounded-full border border-dashed px-3 text-[13px] text-destructive">
            {selected} is no longer in the module
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label id={labelId}>
        {field.label}
        {field.required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {body}
    </div>
  );
}

export const ModuleAssetFieldRenderer: CustomFieldRenderer = (props) => <ModuleAssetField {...props} />;

/** The step's `asset` fields told which installed module's files they list. */
export function withAssetModule(fields: ConfigField[], moduleId: string | undefined): ConfigField[] {
  if (!moduleId) {
    return fields;
  }
  return fields.map((field) => (field.type === "asset" ? { ...field, [ASSET_MODULE_PROPERTY]: moduleId } : field));
}
