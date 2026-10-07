import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstance } from "@/hooks/use-instance";
import { placementChoices, type SceneOption, sceneChoices } from "@/lib/scene-field-options";

function useInstanceScenes() {
  const { instance } = useInstance();
  return useQuery(api.scenes.list, instance ? { instanceId: instance._id } : "skip");
}

function OptionSelect({
  field,
  value,
  onChange,
  options,
  loading,
  empty,
}: Parameters<CustomFieldRenderer>[0] & { options: SceneOption[]; loading: boolean; empty: string }) {
  const selected = typeof value === "string" ? value : "";
  // A saved value no longer offered (a deleted scene or widget) stays visible, marked.
  const missing = selected !== "" && !loading && !options.some((option) => option.value === selected);
  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Select value={selected} onValueChange={onChange} disabled={loading || (options.length === 0 && !missing)}>
        <SelectTrigger id={field.id} data-testid={`select-${field.id}`}>
          <SelectValue placeholder={options.length === 0 ? empty : undefined} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {missing && (
            <SelectItem value={selected} disabled>
              No longer there
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {missing && (
        <p className="text-xs text-destructive" data-testid={`warning-${field.id}`}>
          That one has been deleted. Pick another, or this step will fail.
        </p>
      )}
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  );
}

function ScenesField(props: Parameters<CustomFieldRenderer>[0]) {
  const scenes = useInstanceScenes();
  return (
    <OptionSelect
      {...props}
      options={sceneChoices(scenes ?? [])}
      loading={scenes === undefined}
      empty="No scenes yet"
    />
  );
}

function ScenePlacementsField(props: Parameters<CustomFieldRenderer>[0]) {
  const scenes = useInstanceScenes();
  const source = (props.field as { source?: { sceneField?: unknown } }).source;
  const sceneField = typeof source?.sceneField === "string" ? source.sceneField : "";
  const sceneId = props.values?.[sceneField];
  return (
    <OptionSelect
      {...props}
      options={placementChoices(scenes ?? [], sceneId)}
      loading={scenes === undefined}
      empty={typeof sceneId === "string" && sceneId ? "No widgets on this scene" : "Pick a scene first"}
    />
  );
}

/** `source: { kind: "scenes" }`: one of the instance's scenes. */
export const ScenesFieldRenderer: CustomFieldRenderer = (props) => <ScenesField {...props} />;

/** `source: { kind: "scenePlacements", sceneField }`: a widget on the scene chosen in `sceneField`. */
export const ScenePlacementsFieldRenderer: CustomFieldRenderer = (props) => <ScenePlacementsField {...props} />;
